/*
 *  Copyright (c) 2015 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree. An additional intellectual property rights grant can be found
 *  in the file PATENTS.  All contributing project authors may
 *  be found in the AUTHORS file in the root of the source tree.
 */
#include "i420a_buffer.h"

// Aligning pointer to 64 bytes for improved performance, e.g. use SIMD.
static const int kBufferAlignment = 64;

namespace webrtc {

I420ABuffer::I420ABuffer(int width, int height)
    : I420ABuffer(width, height, width, (width + 1) / 2, (width + 1) / 2) {}

I420ABuffer::I420ABuffer(int width,
                       int height,
                       int stride_y,
                       int stride_u,
                       int stride_v)
    : I420Buffer(width, height,stride_y, stride_u, stride_v),
      dataAlpha_(static_cast<uint8_t*>(
          AlignedMalloc(stride_y * height,
                        kBufferAlignment))) {
}

I420ABuffer::~I420ABuffer() {}

// static
rtc::scoped_refptr<I420ABuffer> I420ABuffer::Create(int width, int height) {
  return new rtc::RefCountedObject<I420ABuffer>(width, height);
}

// static
rtc::scoped_refptr<I420ABuffer> I420ABuffer::Create(int width,
                                                  int height,
                                                  int stride_y,
                                                  int stride_u,
                                                  int stride_v) {
  return new rtc::RefCountedObject<I420ABuffer>(width, height, stride_y,
                                               stride_u, stride_v);
}

const uint8_t* I420ABuffer::DataA() const {
  return dataAlpha_.get();
}

int I420ABuffer::StrideA() const {
  return StrideY();
}

uint8_t* I420ABuffer::MutableDataA() {
  return const_cast<uint8_t*>(DataA());
}


}  // namespace webrtc
