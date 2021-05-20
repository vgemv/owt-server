// Copyright (C) <2019> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

#ifndef VideoScene_h
#define VideoScene_h

#include "VideoLayout.h"

#include <list>
#include <string>

namespace webrtc{
    class VideoFrame;
}

namespace mcu {

struct ImageData {
    uint8_t* data;
    uint32_t size;
    ImageData(uint32_t size):data((uint8_t*)malloc(size)),size(size){}
    ~ImageData(){
        free(data);
    }
};

struct Overlay {
    boost::shared_ptr<ImageData> image;
    rtc::scoped_refptr<webrtc::VideoFrameBuffer> imageBuffer;
    int z;
    double x;
    double y;
    double width;
    double height;
    bool disabled;
};

struct SceneSolution {
    std::string layoutEffect;
    boost::shared_ptr<ImageData> bgImage;
    boost::shared_ptr<LayoutSolution> layout;
    boost::shared_ptr<std::vector<Overlay>> overlays;
};

}

#endif