// Copyright (C) <2019> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

#ifndef VideoMixer_h
#define VideoMixer_h

#include <boost/shared_ptr.hpp>
#include <boost/thread/shared_mutex.hpp>
#include <logger.h>
#include <map>
#include <set>

#include "MediaFramePipeline.h"
#include "VideoLayout.h"
#include "VideoScene.h"

namespace mcu {

class VideoFrameMixer;

struct VideoMixerConfig {
    uint32_t maxInput;
    bool crop;
    std::string resolution;
    struct {
        int r;
        int g;
        int b;
    } bgColor;
    boost::shared_ptr<ImageData> bgImage;
    bool useGacc;
    uint32_t MFE_timeout;
};

class VideoMixer {
    DECLARE_LOGGER();

public:
    VideoMixer(const VideoMixerConfig& config);
    virtual ~VideoMixer();

    bool addInput(const int inputIndex, const std::string& codec, owt_base::FrameSource* source, const std::string& avatar);
    bool addInput(const int inputIndex, const std::string& codec, owt_base::FrameSource* source, boost::shared_ptr<ImageData> avatar);
    void removeInput(const int inputIndex);
    void setInputActive(const int inputIndex, bool active);
    bool setAvatar(const int inputIndex, const std::string& avatar);
    bool setAvatar(const int inputIndex, boost::shared_ptr<ImageData> avatar);
    bool addOutput(const std::string& outStreamID
            , const std::string& codec
            , const owt_base::VideoCodecProfile profile
            , const std::string& resolution
            , const unsigned int framerateFPS
            , const unsigned int bitrateKbps
            , const unsigned int keyFrameIntervalSeconds
            , owt_base::FrameDestination* dest);
    void removeOutput(const std::string& outStreamID);
    void forceKeyFrame(const std::string& outStreamID);

    // Update Layout solution
    void updateLayoutSolution(LayoutSolution& solution);
    void updateSceneSolution(SceneSolution& solution);

    void drawText(const std::string& textSpec);
    void clearText();

private:
    void closeAll();

    int m_nextOutputIndex;

    boost::shared_ptr<VideoFrameMixer> m_frameMixer;

    uint32_t m_maxInputCount;
    std::set<int> m_inputs;

    boost::shared_mutex m_outputsMutex;
    std::map<std::string, int32_t> m_outputs;
};

} /* namespace mcu */
#endif /* VideoMixer_h */
