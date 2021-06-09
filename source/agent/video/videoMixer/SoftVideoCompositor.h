// Copyright (C) <2019> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

#ifndef SoftVideoCompositor_h
#define SoftVideoCompositor_h

#include <vector>

#include <boost/scoped_ptr.hpp>
#include <boost/shared_ptr.hpp>
#include <boost/asio.hpp>
#include <boost/thread.hpp>

#include <webrtc/system_wrappers/include/clock.h>
#include <webrtc/api/video/video_frame.h>
#include <webrtc/api/video/i420_buffer.h>

#include "logger.h"
#include "JobTimer.h"
#include "MediaFramePipeline.h"
#include "FrameConverter.h"
#include "VideoFrameMixer.h"
#include "VideoLayout.h"
#include "VideoScene.h"
#include "I420BufferManager.h"
#include "FFmpegDrawText.h"

namespace mcu {
class SoftVideoCompositor;

class AvatarManager {
    DECLARE_LOGGER();

public:
    AvatarManager(uint8_t size);
    ~AvatarManager();

    bool setAvatar(uint8_t index, const std::string &url);
    bool setAvatar(uint8_t index, boost::shared_ptr<ImageData> frame);
    bool unsetAvatar(uint8_t index);

    boost::shared_ptr<webrtc::VideoFrame> getAvatarFrame(uint8_t index);

protected:
    bool getImageSize(const std::string &url, uint32_t *pWidth, uint32_t *pHeight);
    boost::shared_ptr<webrtc::VideoFrame> loadImage(const std::string &url);

private:
    uint8_t m_size;

    std::map<uint8_t, std::string> m_inputs;
    std::map<std::string, boost::shared_ptr<webrtc::VideoFrame>> m_frames;
    std::map<uint8_t, boost::shared_ptr<webrtc::VideoFrame>> m_indexedFrames;

    boost::shared_mutex m_mutex;
};

class SoftInput {
    DECLARE_LOGGER();

public:
    SoftInput();
    ~SoftInput();

    void setActive(bool active);
    bool isActive(void);
    void setConnected(bool connected);
    bool isConnected(void);

    void pushInput(webrtc::VideoFrame *videoFrame);
    boost::shared_ptr<webrtc::VideoFrame> popInput();

private:
    bool m_active;
    bool m_connected;
    boost::shared_ptr<webrtc::VideoFrame> m_busyFrame;
    boost::shared_mutex m_mutex;

    boost::scoped_ptr<owt_base::I420BufferManager> m_bufferManager;

    boost::scoped_ptr<owt_base::FrameConverter> m_converter;
};

class SoftFrameGenerator : public JobTimerListener
{
    DECLARE_LOGGER();

    const uint32_t kMsToRtpTimestamp = 90;

    struct Output_t {
        uint32_t width;
        uint32_t height;
        uint32_t fps;
        owt_base::FrameDestination *dest;
    };

public:
    SoftFrameGenerator(
            SoftVideoCompositor *owner,
            owt_base::VideoSize &size,
            owt_base::YUVColor &bgColor,
            const rtc::scoped_refptr<webrtc::VideoFrameBuffer> bgFrame,
            const bool crop,
            const uint32_t maxFps,
            const uint32_t minFps);

    ~SoftFrameGenerator();

    void updateLayoutSolution(LayoutSolution& solution);
    void updateSceneSolution(SceneSolution& solution);
    void updateInputOverlay(int inputId, std::vector<Overlay>& overlays);

    bool isSupported(uint32_t width, uint32_t height, uint32_t fps);

    bool addOutput(const uint32_t width, const uint32_t height, const uint32_t fps, owt_base::FrameDestination *dst);
    bool removeOutput(owt_base::FrameDestination *dst);

    void drawText(const std::string& textSpec);
    void clearText();

    void onTimeout() override;

protected:
    rtc::scoped_refptr<webrtc::VideoFrameBuffer> generateFrame();
    rtc::scoped_refptr<webrtc::VideoFrameBuffer> layout();
    void calculateTweenLayout();
    static void layout_regions(SoftFrameGenerator *t, rtc::scoped_refptr<webrtc::I420Buffer> compositeBuffer, const LayoutSolution &regions, const std::vector<std::vector<Overlay>> &inputOverlays);
    static void layout_overlays(SoftFrameGenerator *t, rtc::scoped_refptr<webrtc::I420Buffer> compositeBuffer, const LayoutSolution &regions, const std::vector<std::vector<Overlay>> &inputOverlays, const std::vector<Overlay> &overlays);
    
    void reconfigureIfNeeded();

private:
    const webrtc::Clock *m_clock;

    SoftVideoCompositor *m_owner;
    uint32_t m_maxSupportedFps;
    uint32_t m_minSupportedFps;

    uint32_t m_counter;
    uint32_t m_counterMax;

    std::vector<std::list<Output_t>>    m_outputs;
    boost::shared_mutex                 m_outputMutex;

    // configure
    owt_base::VideoSize     m_size;
    owt_base::YUVColor      m_bgColor;
    rtc::scoped_refptr<webrtc::VideoFrameBuffer> m_bgFrame;

    bool                        m_crop;

    std::vector<Overlay>          m_newOverlays;
    std::vector<Overlay>          m_overlays;
    
    std::map<int,std::vector<Overlay>>         m_newInputOverlays;
    std::vector<std::vector<Overlay>>          m_inputOverlays;

    // reconfifure
    LayoutSolution              m_layout;
    LayoutSolution              m_targetLayout;
    LayoutSolution              m_newLayout;
    bool                        m_configureChanged;
    int                         m_tweenEffect;
    boost::shared_mutex         m_configMutex;

    boost::scoped_ptr<owt_base::I420BufferManager> m_bufferManager;

    boost::scoped_ptr<JobTimer> m_jobTimer;

    // parallel composition
    uint32_t m_parallelNum;
    boost::shared_ptr<boost::asio::io_service> m_srv;
    boost::shared_ptr<boost::asio::io_service::work> m_srvWork;
    boost::shared_ptr<boost::thread_group> m_thrGrp;

    boost::shared_ptr<owt_base::FFmpegDrawText> m_textDrawer;
};

/**
 * composite a sequence of frames into one frame based on current layout config,
 * In the future, we may enable the video rotation based on VAD history.
 */
class SoftVideoCompositor : public VideoFrameCompositor {
    DECLARE_LOGGER();

    friend class SoftFrameGenerator;

public:
    SoftVideoCompositor(uint32_t maxInput, owt_base::VideoSize rootSize, owt_base::YUVColor bgColor, const rtc::scoped_refptr<webrtc::VideoFrameBuffer> bgFrame, bool crop);
    ~SoftVideoCompositor();

    bool addInput(int input);
    bool removeInput(int input);
    bool activateInput(int input);
    void deActivateInput(int input);
    bool setAvatar(int input, const std::string& avatar);
    bool setAvatar(int input, boost::shared_ptr<ImageData> avatar);
    bool unsetAvatar(int input);
    void pushInput(int input, const owt_base::Frame&);

    void updateRootSize(owt_base::VideoSize& rootSize);
    void updateBackgroundColor(owt_base::YUVColor& bgColor);
    void updateLayoutSolution(LayoutSolution& solution);
    void updateSceneSolution(SceneSolution& solution);
    void updateInputOverlay(int inputId, std::vector<Overlay>& overlays);

    bool addOutput(const uint32_t width, const uint32_t height, const uint32_t framerateFPS, owt_base::FrameDestination *dst) override;
    bool removeOutput(owt_base::FrameDestination *dst) override;

    void drawText(const std::string& textSpec);
    void clearText();

protected:
    boost::shared_ptr<webrtc::VideoFrame> getInputFrame(int index);

private:
    uint32_t m_maxInput;
    uint32_t m_maxStaticInput;

    std::vector<boost::shared_ptr<SoftFrameGenerator>> m_generators;

    std::vector<boost::shared_ptr<SoftInput>> m_staticInputs;
    std::vector<boost::shared_ptr<SoftInput>> m_inputs;
    boost::scoped_ptr<AvatarManager> m_staticAvatarManager;
    boost::scoped_ptr<AvatarManager> m_avatarManager;
    rtc::scoped_refptr<webrtc::VideoFrameBuffer> m_bgFrame;
};

}
#endif /* SoftVideoCompositor_h*/
