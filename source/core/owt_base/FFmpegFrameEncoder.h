// Copyright (C) <2019> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

#ifndef FFmpegFrameEncoder_h
#define FFmpegFrameEncoder_h

#include <map>
#include <atomic>

#include <boost/scoped_ptr.hpp>
#include <boost/shared_ptr.hpp>
#include <boost/asio.hpp>
#include <boost/thread.hpp>


#include "logger.h"
#include "MediaFramePipeline.h"
#include "FrameConverter.h"

extern "C" {
#include <libavcodec/avcodec.h>
}

using namespace webrtc;

namespace owt_base {


/**
 * This is the class to accept the raw frame and encode it to the given format.
 */
class FFmpegFrameEncoder : public VideoFrameEncoder {
    DECLARE_LOGGER();

public:
    FFmpegFrameEncoder(FrameFormat format, VideoCodecProfile profile, bool useSimulcast = false);
    ~FFmpegFrameEncoder();

    static bool supportFormat(FrameFormat format) {
        return (
                format == FRAME_FORMAT_H264
                || format == FRAME_FORMAT_H265);
    }

    FrameFormat getInputFormat() {return FRAME_FORMAT_I420;}

    // Implements VideoFrameEncoder.
    void onFrame(const Frame&);
    bool canSimulcast(FrameFormat format, uint32_t width, uint32_t height);
    bool isIdle();
    int32_t generateStream(uint32_t width, uint32_t height, uint32_t frameRate, uint32_t bitrateKbps, uint32_t keyFrameIntervalSeconds, FrameDestination* dest);
    void degenerateStream(int32_t streamId);
    void setBitrate(unsigned short kbps, int32_t streamId);
    void requestKeyFrame(int32_t streamId);

protected:
    static void Encode(FFmpegFrameEncoder *This, AVFrame* videoFrame) {This->encode(videoFrame);};
    void encode(AVFrame* videoFrame);

    AVFrame* frameConvert(const Frame& frame);

    void dump(uint8_t *buf, int len);

    char m_errbuff[500];
    char * ff_err2str(int errRet);
private:

    class EncodeOut : public FrameSource {
    public:
        EncodeOut(int32_t streamId, owt_base::VideoFrameEncoder* owner, owt_base::FrameDestination* dest)
            : m_streamId(streamId), m_owner(owner), m_out(dest) {
            addVideoDestination(dest);
        }
        virtual ~EncodeOut() {
            removeVideoDestination(m_out);
        }

        void onFeedback(const owt_base::FeedbackMsg& msg) {
            if (msg.type == owt_base::VIDEO_FEEDBACK) {
                if (msg.cmd == REQUEST_KEY_FRAME) {
                    m_owner->requestKeyFrame(m_streamId);
                } else if (msg.cmd == SET_BITRATE) {
                    m_owner->setBitrate(msg.data.kbps, m_streamId);
                }
            }
        }

        void onEncoded(const owt_base::Frame& frame) {
            deliverFrame(frame);
        }

    private:
        int32_t m_streamId;
        owt_base::VideoFrameEncoder* m_owner;
        owt_base::FrameDestination* m_out;
    };

    struct OutStream {
        uint32_t width;
        uint32_t height;
        int32_t  simulcastId;
        boost::shared_ptr<EncodeOut> encodeOut;
    };

    int32_t m_streamId;
    std::map<int32_t/*streamId*/, OutStream> m_streams;

    FrameFormat m_encodeFormat;
    VideoCodecProfile m_profile;
    boost::shared_mutex m_mutex;

    boost::shared_ptr<boost::asio::io_service> m_srv;
    boost::shared_ptr<boost::asio::io_service::work> m_srvWork;
    boost::shared_ptr<boost::thread> m_thread;

    std::atomic<bool> m_requestKeyFrame;
    std::atomic<uint32_t> m_updateBitrateKbps;

    bool m_isAdaptiveMode;
    int32_t m_width;
    int32_t m_height;
    uint32_t m_frameRate;
    uint32_t m_bitrateKbps;

    boost::scoped_ptr<FrameConverter> m_converter;

    bool m_enableBsDump;
    FILE *m_bsDumpfp;

    //

    AVCodecContext *m_encCtx;
    AVPacket avpkt;
};

} /* namespace owt_base */
#endif /* FFmpegFrameEncoder_h */
