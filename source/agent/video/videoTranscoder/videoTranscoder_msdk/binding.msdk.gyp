{
  'targets': [{
    'target_name': 'videoTranscoder-msdk',
    'sources': [
      '../addon.cc',
      '../VideoTranscoderWrapper.cc',
      '../VideoTranscoder.cpp',
      '../../../../core/owt_base/I420BufferManager.cpp',
      '../../../../core/owt_base/MediaFramePipeline.cpp',
      '../../../../core/owt_base/FrameConverter.cpp',
      '../../../../core/owt_base/VCMFrameDecoder.cpp',
      '../../../../core/owt_base/VCMFrameEncoder.cpp',
      '../../../../core/owt_base/FFmpegFrameDecoder.cpp',
      '../../../../core/owt_base/FFmpegDrawText.cpp',
      '../../../../core/owt_base/FrameProcesser.cpp',
      '../../../../core/owt_base/MsdkFrameDecoder.cpp',
      '../../../../core/owt_base/MsdkFrameEncoder.cpp',
      '../../../../core/owt_base/MsdkBase.cpp',
      '../../../../core/owt_base/MsdkFrame.cpp',
      '../../../../core/owt_base/MsdkScaler.cpp',
      '../../../../core/owt_base/FastCopy.cpp',
      '../../../../core/common/JobTimer.cpp',
      '../../../../../third_party/mediasdk/samples/sample_common/src/base_allocator.cpp',
      '../../../../../third_party/mediasdk/samples/sample_common/src/vaapi_allocator.cpp',
    ],
    'cflags_cc': [
        '-Wall',
        '-O$(OPTIMIZATION_LEVEL)',
        '-g',
        '-std=c++11',
        '-DWEBRTC_POSIX',
        '-DENABLE_MSDK',
        '-msse4',
    ],
    'cflags_cc!': [
        '-fno-exceptions',
    ],
    'include_dirs': [ '..',
                      '$(CORE_HOME)/common',
                      '$(CORE_HOME)/owt_base',
                      '$(CORE_HOME)/../../third_party/webrtc/src',
                      '$(CORE_HOME)/../../third_party/webrtc/src/third_party/libyuv/include',
                      '$(CORE_HOME)/../../third_party/mediasdk/samples/sample_common/include',
                      '$(DEFAULT_DEPENDENCY_PATH)/include',
                      '$(CUSTOM_INCLUDE_PATH)',
                      '/opt/intel/mediasdk/include',
    ],
    'libraries': [
      '-lboost_thread',
      '-llog4cxx',
      '-L$(CORE_HOME)/../../third_party/webrtc', '-lwebrtc',
      '-L$(CORE_HOME)/../../third_party/openh264', '-lopenh264',
      '-L/opt/intel/mediasdk/lib64', '-lmfx -lva -lva-drm',
      '<!@(pkg-config --libs libavutil)',
      '<!@(pkg-config --libs libavcodec)',
      '<!@(pkg-config --libs libavformat)',
      '<!@(pkg-config --libs libavfilter)',
    ],
  }]
}
