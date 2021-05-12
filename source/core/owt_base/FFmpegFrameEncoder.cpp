// Copyright (C) <2019> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

#include <boost/make_shared.hpp>

#include <webrtc/system_wrappers/include/cpu_info.h>
#include <webrtc/modules/video_coding/codec_database.h>

#include "FFmpegFrameEncoder.h"

#include "MediaUtilities.h"
extern "C"{
    #include <libavutil/opt.h>
}

using namespace webrtc;

namespace owt_base {

DEFINE_LOGGER(FFmpegFrameEncoder, "owt.FFmpegFrameEncoder");

FFmpegFrameEncoder::FFmpegFrameEncoder(FrameFormat format, VideoCodecProfile profile, bool useSimulcast)
    : m_streamId(0)
    , m_encodeFormat(format)
    , m_profile(profile)
    , m_requestKeyFrame(false)
    , m_updateBitrateKbps(0)
    , m_isAdaptiveMode(false)
    , m_width(0)
    , m_height(0)
    , m_frameRate(0)
    , m_bitrateKbps(0)
    , m_enableBsDump(false)
    , m_bsDumpfp(NULL)
{
    m_converter.reset(new FrameConverter());

    m_srv       = boost::make_shared<boost::asio::io_service>();
    m_srvWork   = boost::make_shared<boost::asio::io_service::work>(*m_srv);
    m_thread    = boost::make_shared<boost::thread>(boost::bind(&boost::asio::io_service::run, m_srv));

    av_init_packet(&avpkt);
}

FFmpegFrameEncoder::~FFmpegFrameEncoder()
{
    m_srvWork.reset();
    m_srv->stop();
    m_thread.reset();
    m_srv.reset();

    m_streamId = 0;

    if (m_bsDumpfp) {
        fclose(m_bsDumpfp);
    }
}

bool FFmpegFrameEncoder::canSimulcast(FrameFormat format, uint32_t width, uint32_t height)
{
#if 0
    VideoCodec videoCodec;
    videoCodec = m_vcm->GetSendCodec();
    return false
           &&webrtc::VP8EncoderFactoryConfig::use_simulcast_adapter()
           && m_encodeFormat == format
           && videoCodec.width * height == videoCodec.height * width;
#endif
    return false;
}

bool FFmpegFrameEncoder::isIdle()
{
    boost::shared_lock<boost::shared_mutex> lock(m_mutex);
    return m_streams.size() == 0;
}

int32_t FFmpegFrameEncoder::generateStream(uint32_t width, uint32_t height, uint32_t frameRate, uint32_t bitrateKbps, uint32_t keyFrameIntervalSeconds, owt_base::FrameDestination* dest)
{
    boost::upgrade_lock<boost::shared_mutex> lock(m_mutex);
    uint32_t targetKbps = bitrateKbps;

    uint8_t simulcastId {0};
    int ret;

    assert(frameRate != 0);


    {
        ELOG_DEBUG_T("Create encoder(%s)", getFormatStr(m_encodeFormat));
        AVCodecID codec_id;
        switch (m_encodeFormat) {
        case FRAME_FORMAT_VP8:
            codec_id = AV_CODEC_ID_VP8;
            break;
        case FRAME_FORMAT_VP9:
            codec_id = AV_CODEC_ID_VP9;
            break;
        case FRAME_FORMAT_H264:
            codec_id = AV_CODEC_ID_H264;
            break;
        case FRAME_FORMAT_H265:
            codec_id = AV_CODEC_ID_HEVC;
            break;
        default:
            ELOG_ERROR_T("Invalid encoder(%s)", getFormatStr(m_encodeFormat));
            return -1;
        }

        AVCodec* enc = avcodec_find_encoder(codec_id);
        if (!enc) {
            ELOG_ERROR_T("Could not find ffmpeg encoder %s", avcodec_get_name(codec_id));
            return false;
        }

        m_encCtx = avcodec_alloc_context3(enc);
        if (!m_encCtx ) {
            ELOG_ERROR_T("Could not alloc ffmpeg encoder context");
            return false;
        }

        /* put sample parameters */
        m_encCtx->bit_rate = bitrateKbps * 1024;
        /* resolution must be a multiple of two */
        m_encCtx->width = width;
        m_encCtx->height = height;
        /* frames per second */
        m_encCtx->time_base = (AVRational){1, 90};
        m_encCtx->framerate = (AVRational){frameRate, 1};

        /* emit one intra frame every ten frames
        * check frame pict_type before passing frame
        * to encoder, if frame->pict_type is AV_PICTURE_TYPE_I
        * then gop_size is ignored and the output of encoder
        * will always be I frame irrespective to gop_size
        */
        m_encCtx->gop_size = frameRate;
        // m_encCtx->max_b_frames = 1;
        m_encCtx->pix_fmt = AV_PIX_FMT_YUV420P;

        if (enc->id == AV_CODEC_ID_H264){
            switch(m_profile){
                case PROFILE_AVC_BASELINE:
                    av_opt_set(m_encCtx->priv_data, "profile", "baseline", 0);
                break;
                case PROFILE_AVC_MAIN:
                    av_opt_set(m_encCtx->priv_data, "profile", "main", 0);
                break;
                case PROFILE_AVC_HIGH:
                    av_opt_set(m_encCtx->priv_data, "profile", "high", 0);
                break;
                case PROFILE_AVC_CONSTRAINED_BASELINE:
                    av_opt_set(m_encCtx->priv_data, "profile", "baseline", 0);
                    av_opt_set(m_encCtx->priv_data, "rc", "cbr", 0);
                break;
            }
            av_opt_set(m_encCtx->priv_data, "preset", "fast", 0);
            av_opt_set(m_encCtx->priv_data, "tune", "zerolatency", 0);
            av_opt_set(m_encCtx->priv_data, "zerolatency", "1", 0);
        }
        if (enc->id == AV_CODEC_ID_HEVC){
            av_opt_set(m_encCtx->priv_data, "preset", "hp", 0);
            av_opt_set(m_encCtx->priv_data, "tune", "zerolatency", 0);
            av_opt_set(m_encCtx->priv_data, "zerolatency", "1", 0);
        }

        ret = avcodec_open2(m_encCtx, enc , NULL);
        if (ret < 0) {
            ELOG_ERROR_T("Could not open ffmpeg encoder context, %s", ff_err2str(ret));
            return false;
        }
    }


    boost::shared_ptr<EncodeOut> encodeOut;
    encodeOut.reset(new EncodeOut(m_streamId, this, dest));
    OutStream stream = {.width = width, .height = height, .simulcastId = simulcastId, .encodeOut = encodeOut};
    m_streams[m_streamId] = stream;
    ELOG_DEBUG_T("generateStream: {.width=%d, .height=%d, .frameRate=%d, .bitrateKbps=%d, .keyFrameIntervalSeconds=%d}, simulcastId=%d, adaptiveMode=%d"
            , width, height, frameRate, bitrateKbps, keyFrameIntervalSeconds, simulcastId, m_isAdaptiveMode);

    m_width = width;
    m_height = height;
    m_frameRate = frameRate;
    m_bitrateKbps = bitrateKbps;


    return m_streamId++;
}

void FFmpegFrameEncoder::degenerateStream(int32_t streamId)
{
    boost::upgrade_lock<boost::shared_mutex> lock(m_mutex);

    ELOG_DEBUG_T("degenerateStream(%d)", streamId);

    auto it = m_streams.find(streamId);
    if (it != m_streams.end()) {
        boost::upgrade_to_unique_lock<boost::shared_mutex> uniqueLock(lock);
        m_streams.erase(streamId);
    }
}

void FFmpegFrameEncoder::setBitrate(unsigned short kbps, int32_t streamId)
{
    boost::shared_lock<boost::shared_mutex> lock(m_mutex);

    ELOG_DEBUG_T("setBitrate(%d), %d(kbps)", streamId, kbps);

    auto it = m_streams.find(streamId);
    if (it != m_streams.end()) {
        m_updateBitrateKbps = kbps;
    }
}

void FFmpegFrameEncoder::requestKeyFrame(int32_t streamId)
{
    boost::shared_lock<boost::shared_mutex> lock(m_mutex);

    ELOG_DEBUG_T("requestKeyFrame(%d)", streamId);

    auto it = m_streams.find(streamId);
    if (it != m_streams.end()) {
        m_requestKeyFrame = true;
    }
}

void FFmpegFrameEncoder::onFrame(const Frame& frame)
{
    boost::shared_lock<boost::shared_mutex> lock(m_mutex);

    if (m_streams.size() == 0) {
        return;
    }

    AVFrame* videoFrame = frameConvert(frame);
    if (videoFrame == NULL) {
        return;
    }

    m_srv->post(boost::bind(&FFmpegFrameEncoder::Encode, this, videoFrame));
}

AVFrame* FFmpegFrameEncoder::frameConvert(const Frame& frame)
{
    int ret;
    int32_t dstFrameWidth = m_isAdaptiveMode ? frame.additionalInfo.video.width : m_width;
    int32_t dstFrameHeight = m_isAdaptiveMode ? frame.additionalInfo.video.height: m_height;


    AVFrame* dstFrame = av_frame_alloc();
    if (!dstFrame) {
        ELOG_ERROR_T("No valid buffer");
        return NULL;
    }

    dstFrame->pts = frame.timeStamp; //av_rescale_q(frame.timeStamp, (AVRational){1, 90}, m_encCtx->time_base);
    dstFrame->format = AV_PIX_FMT_YUV420P;
    dstFrame->width  = dstFrameWidth;
    dstFrame->height = dstFrameHeight;
    // ELOG_ERROR_T("Timestamp: %ld", frame.timeStamp / 90);

    ret = av_frame_get_buffer(dstFrame, 0);
    if (ret < 0) {
        ELOG_ERROR_T("Could not allocate the video frame data");
        return NULL;
    }

    switch (frame.format) {
    case FRAME_FORMAT_I420: {
        if (m_encodeFormat == FRAME_FORMAT_UNKNOWN)
            return NULL;

        VideoFrame *inputFrame = reinterpret_cast<VideoFrame*>(frame.payload);
        rtc::scoped_refptr<webrtc::VideoFrameBuffer> inputBuffer = inputFrame->video_frame_buffer();

        if (!m_converter->convert(inputBuffer.get(), dstFrame)) {
            ELOG_ERROR_T("frameConverter failed");
            return NULL;
        }
        break;
    }
#ifdef ENABLE_MSDK
    case FRAME_FORMAT_MSDK: {
        if (m_encodeFormat == FRAME_FORMAT_UNKNOWN)
            return NULL;

        MsdkFrameHolder *holder = (MsdkFrameHolder *)frame.payload;
        boost::shared_ptr<MsdkFrame> msdkFrame = holder->frame;

        if (!m_converter->convert(msdkFrame.get(), rawBuffer.get())) {
            ELOG_ERROR_T("frameConverter failed");
            return NULL;
        }

        dstFrame.reset(new VideoFrame(rawBuffer, frame.timeStamp, 0, webrtc::kVideoRotation_0));
        break;
    }
#endif
    default:
        assert(false);
        return NULL;
    }

    return dstFrame;
}

void FFmpegFrameEncoder::encode(AVFrame* frame)
{
    boost::shared_lock<boost::shared_mutex> lock(m_mutex);
    int ret;

    if (m_streams.size() == 0) {
        return;
    }

    if (m_width != frame->width || m_height != frame->height) {
        ELOG_DEBUG_T("Update encoder resolution %dx%d->%dx%d", m_width, m_height, frame->width, frame->height);

        //todo

        m_width = frame->width;
        m_height = frame->height;
        m_updateBitrateKbps = calcBitrate(m_width, m_height, m_frameRate);
    }

    if (m_updateBitrateKbps) {
        ELOG_DEBUG_T("Update encoder bitrate %d(kbps)->%d(kbps)", m_bitrateKbps, m_updateBitrateKbps.load());

        if (m_bitrateKbps != m_updateBitrateKbps) {
            BitrateAllocation bitrate;
            bitrate.SetBitrate(0, 0, m_updateBitrateKbps * 1000);

            // ret = m_encoder->SetRateAllocation(bitrate, m_frameRate);
            //todo

            if (ret != 0) {
                ELOG_WARN_T("Update Encode bitrate error: %d", ret);
            }
            m_bitrateKbps = m_updateBitrateKbps;
        }
        m_updateBitrateKbps = 0;
    }

    // std::vector<FrameType> types;
    if (m_requestKeyFrame) {
        // types.push_back(kVideoFrameKey);
        frame->pict_type = AV_PICTURE_TYPE_I;
        frame->key_frame = 1;
        m_requestKeyFrame = false;
    }

    ret = avcodec_send_frame(m_encCtx, frame);
    av_frame_free(&frame);

    // ret = m_encoder->Encode(*frame.get(), NULL, types.size() ? &types : NULL);
    if (ret != 0) {
        ELOG_ERROR_T("Encode frame error: %d", ret);
    }

    while(avcodec_receive_packet(m_encCtx, &avpkt) == 0){

        Frame outFrame;
        memset(&outFrame, 0, sizeof(outFrame));
        outFrame.format = m_encodeFormat;
        outFrame.payload = avpkt.data;
        outFrame.length = avpkt.size;
        outFrame.additionalInfo.video.width = m_width;
        outFrame.additionalInfo.video.height = m_height;
        outFrame.additionalInfo.video.isKeyFrame = avpkt.flags & AV_PKT_FLAG_KEY;
        outFrame.timeStamp = avpkt.pts;//(m_frameCount++) * 1000 / m_frameRate * 90;

        ELOG_TRACE_T("deliverFrame, %s, %dx%d(%s), length(%d)",
                getFormatStr(outFrame.format),
                outFrame.additionalInfo.video.width,
                outFrame.additionalInfo.video.height,
                outFrame.additionalInfo.video.isKeyFrame ? "key" : "delta",
                outFrame.length);

        dump(outFrame.payload, outFrame.length);


        if (!m_streams.empty()) {
            auto it = m_streams.begin();
            for (; it != m_streams.end(); ++it) {
                if (it->second.encodeOut.get() && it->second.simulcastId == 0)
                    it->second.encodeOut->onEncoded(outFrame);
            }
        }
        
    }

    // av_free_packet(&pkt);
}

void FFmpegFrameEncoder::dump(uint8_t *buf, int len)
{
    if (m_bsDumpfp) {
        if (m_encodeFormat == FRAME_FORMAT_VP8 || m_encodeFormat == FRAME_FORMAT_VP9) {
            unsigned char mem[4];

            mem[0] = (len >>  0) & 0xff;
            mem[1] = (len >>  8) & 0xff;
            mem[2] = (len >> 16) & 0xff;
            mem[3] = (len >> 24) & 0xff;

            fwrite(&mem, 1, 4, m_bsDumpfp);
        }

        fwrite(buf, 1, len, m_bsDumpfp);
    }
}
char *FFmpegFrameEncoder::ff_err2str(int errRet)
{
    av_strerror(errRet, (char*)(&m_errbuff), 500);
    return m_errbuff;
}
} // namespace owt_base
