/*
 *  Copyright (c) 2015 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree. An additional intellectual property rights grant can be found
 *  in the file PATENTS.  All contributing project authors may
 *  be found in the AUTHORS file in the root of the source tree.
 */

#ifndef API_VIDEO_I420A_BUFFER_H_
#define API_VIDEO_I420A_BUFFER_H_

#include <webrtc/api/video/i420_buffer.h>

namespace webrtc {

// Plain I420 buffer in standard memory.
class I420ABuffer : public I420Buffer {
 public:
  static rtc::scoped_refptr<I420ABuffer> Create(int width, int height);
  static rtc::scoped_refptr<I420ABuffer> Create(int width,
                                               int height,
                                               int stride_y,
                                               int stride_u,
                                               int stride_v);

  const uint8_t* DataA() const ;

  int StrideA() const ;

  uint8_t* MutableDataA();

 protected:
  I420ABuffer(int width, int height);
  I420ABuffer(int width, int height, int stride_y, int stride_u, int stride_v);

  ~I420ABuffer() override;

 private:
  const std::unique_ptr<uint8_t, AlignedFreeDeleter> dataAlpha_;
};

}  // namespace webrtc

#endif  // API_VIDEO_I420_BUFFER_H_
