#include "VideoHelper.h"
#include <memory>
extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libswscale/swscale.h>
}

// #include <webrtc/api/video/i420_buffer.h>
#include "i420a_buffer.h"

namespace owt_base {

DEFINE_LOGGER(ImageHelper, "owt.ImageHelper");

struct InMemoryFile {
    const uint8_t* data;
    uint32_t size;
    uint32_t offset;
    InMemoryFile():data(NULL),size(0),offset(0){}
};

static int read_packet(void *opaque, uint8_t *buf, int buf_size)
{
    int size = buf_size;
    InMemoryFile* file = (InMemoryFile*)opaque;
    
    if (file->size - file->offset < buf_size)
        size = file->size - file->offset;
    if (size > 0)
    {
        memcpy(buf, file->data + file->offset, size);
        file->offset += size;
    }
    return size;
}
static int64_t seek_packet(void *opaque, int64_t offset, int whence) {
    InMemoryFile* file = (InMemoryFile*)opaque;

    if (0x10000 == whence)
        return file->size;

    return file->offset = offset; 
}

static char m_errbuff[500];
static char *ff_err2str(int errRet)
{
    av_strerror(errRet, (char*)(&m_errbuff), 500);
    return m_errbuff;
}
int ImageHelper::getVideoFrame(const uint8_t* data, uint32_t size, rtc::scoped_refptr<webrtc::I420ABuffer>& frame){

    int ret = 0;
    AVIOContext* ioctx = NULL;
    AVFormatContext* fc = NULL;
    AVCodecID codec_id;
    AVCodec* dec = NULL;
    AVCodecContext* decCtx = NULL;
    SwsContext* swsCtx = NULL;
    AVFrame* decFrame = NULL;
    AVPacket pkt;
    void* avbuff = NULL;
    uint8_t* desData[3];
    int desLinesize[3];
    rtc::scoped_refptr<webrtc::I420ABuffer> buffer;


    av_init_packet(&pkt);

    avbuff = av_malloc(4096);
    InMemoryFile file;
    file.data = data;
    file.size = size;

    ioctx = avio_alloc_context((unsigned char*)avbuff, 4096, 0, &file, read_packet, NULL, seek_packet);

    fc = avformat_alloc_context();
    fc->pb = ioctx;
    if (( ret = avformat_open_input(&fc, "nofile", NULL, NULL) ) != 0) {
        ELOG_ERROR("Could not open format error: %s", ff_err2str(ret));
        goto fail;
    }

    codec_id = fc->streams[0]->codecpar->codec_id;

    dec = avcodec_find_decoder(codec_id);
    if (!dec) {
        ELOG_ERROR("Could not find ffmpeg decoder %s", avcodec_get_name(codec_id));
        goto fail;
    }

    ELOG_DEBUG("Created %s decoder.", dec->name);

    decCtx = avcodec_alloc_context3(dec);
    if (!decCtx ) {
        ELOG_ERROR("Could not alloc ffmpeg decoder context");
        goto fail;
    }

    ret = avcodec_open2(decCtx, dec , NULL);
    if (ret < 0) {
        ELOG_ERROR("Could not open ffmpeg decoder context, %s", ff_err2str(ret));
        goto fail;
    }

    decFrame = av_frame_alloc();
    if (!decFrame) {
        ELOG_ERROR("Could not allocate dec frame");
        ret = AVERROR(ENOMEM);
        goto fail;
    }

    // start decoding

    if( ( ret = av_read_frame(fc, &pkt) ) != 0){
        ELOG_ERROR("Could not read pkt: %s", ff_err2str(ret));
        goto fail;
    }

    if( ( ret = avcodec_send_packet(decCtx, &pkt) ) != 0){
        ELOG_ERROR("Could not send pkt: %s", ff_err2str(ret));
        goto fail;
    }

    av_packet_unref(&pkt);

    if( ( ret = avcodec_receive_frame(decCtx, decFrame) ) != 0){
        ELOG_ERROR("Could not receive frame: %s", ff_err2str(ret));
        goto fail;
    }

    // start resampling

    frame = buffer = webrtc::I420ABuffer::Create(decFrame->width, decFrame->height);

    desData[0] = 
        buffer->MutableDataY();
    desData[1] = 
        buffer->MutableDataU();
    desData[2] = 
        buffer->MutableDataV();
    desData[3] = 
        buffer->MutableDataA();
    desLinesize[0] = 
        buffer->StrideY();
    desLinesize[1] = 
        buffer->StrideU();
    desLinesize[2] = 
        buffer->StrideV();
    desLinesize[3] = 
        buffer->StrideA();

    swsCtx = sws_getContext(
        decFrame->width,
        decFrame->height,
        (AVPixelFormat)decFrame->format,
        decFrame->width,
        decFrame->height,
        AV_PIX_FMT_YUVA420P,
        SWS_BILINEAR, NULL, NULL, NULL
    );
    sws_scale(swsCtx, (const uint8_t * const *) decFrame->data,
        decFrame->linesize, 0, decFrame->height, 
        desData,
        desLinesize);

    ELOG_DEBUG("Done decoding");

fail:    
    // if(avbuff)
    //     av_free(avbuff);
    if(ioctx)
        av_freep(&ioctx->buffer);
    if(ioctx)
        avio_context_free(&ioctx);
    if(fc)
        avformat_close_input(&fc);
    if(decCtx)
        avcodec_free_context(&decCtx);
    if(swsCtx)
        sws_freeContext(swsCtx);
    
    if(decFrame)
        av_frame_free(&decFrame);
    return ret;
}

}