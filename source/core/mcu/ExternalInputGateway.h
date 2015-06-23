/*
 * Copyright 2015 Intel Corporation All Rights Reserved. 
 * 
 * The source code contained or described herein and all documents related to the 
 * source code ("Material") are owned by Intel Corporation or its suppliers or 
 * licensors. Title to the Material remains with Intel Corporation or its suppliers 
 * and licensors. The Material contains trade secrets and proprietary and 
 * confidential information of Intel or its suppliers and licensors. The Material 
 * is protected by worldwide copyright and trade secret laws and treaty provisions. 
 * No part of the Material may be used, copied, reproduced, modified, published, 
 * uploaded, posted, transmitted, distributed, or disclosed in any way without 
 * Intel's prior express written permission.
 * 
 * No license under any patent, copyright, trade secret or other intellectual 
 * property right is granted to or conferred upon you by disclosure or delivery of 
 * the Materials, either expressly, by implication, inducement, estoppel or 
 * otherwise. Any license under such intellectual property rights must be express 
 * and approved by Intel in writing.
 */

#ifndef ExternalInputGateway_h
#define ExternalInputGateway_h

#include "media/AudioMixer.h"

#include <boost/thread/shared_mutex.hpp>
#include <Gateway.h>
#include <logger.h>
#include <map>
#include <MediaDefinitions.h>
#include <string>
#include <VideoFrameSender.h>
#include <VideoFrameTranscoder.h>

namespace mcu {

/**
 * Represents a gateway between an ExternalInput publisher (e.g., RTSP) and WebRTC subscribers.
 * Receives media from the ExternalInput and dispatches it to others.
 */
class ExternalInputGateway : public woogeen_base::Gateway, public erizo::MediaSink, public erizo::FeedbackSink, public erizo::RTPDataReceiver {
    DECLARE_LOGGER();

public:
    ExternalInputGateway();
    virtual ~ExternalInputGateway();

    // Implements Gateway.
    bool addPublisher(erizo::MediaSource*, const std::string& participantId);
    bool addPublisher(erizo::MediaSource* source, const std::string& participantId, const std::string& videoResolution) { return addPublisher(source, participantId); }
    void removePublisher(const std::string& participantId);

    void addSubscriber(erizo::MediaSink*, const std::string& id);
    void removeSubscriber(const std::string& id);

    // TODO: implement the below interfaces to support async event notification
    // from the native layer to the JS (controller) layer.
    void setupAsyncEvent(const std::string& event, woogeen_base::EventRegistry* handler)
    {
        m_asyncHandler.reset(handler);
        m_asyncHandler->notify("");
    }
    void destroyAsyncEvents() { m_asyncHandler.reset(); }

    void customMessage(const std::string& message) { }

    // TODO: implement the below interface to support Gateway statistics retrieval,
    // which can be used to monitor the gateway. Refer to ooVoo Gateway for example.
    std::string retrieveStatistics() { return ""; }

    // TODO: implement the below interfaces to support media play/pause.
    void subscribeStream(const std::string& id, bool isAudio) { }
    void unsubscribeStream(const std::string& id, bool isAudio) { }
    void publishStream(const std::string& id, bool isAudio) { }
    void unpublishStream(const std::string& id, bool isAudio) { }

    bool addExternalOutput(const std::string& configParam);
    bool removeExternalOutput(const std::string& outputId);

    // TODO: It's ugly to override setAudioSink/setVideoSink,
    // but we need to explicitly manage the synchronization of the sink setting/getting now,
    void setAudioSink(erizo::MediaSink*);
    void setVideoSink(erizo::MediaSink*);
    int sendFirPacket();
    int setVideoCodec(const std::string& codecName, unsigned int clockRate);
    int setAudioCodec(const std::string& codecName, unsigned int clockRate);

    // Implements MediaSink.
    int deliverAudioData(char*, int len);
    int deliverVideoData(char*, int len);

    // Implements FeedbackSink.
    int deliverFeedback(char* buf, int len);

    // Implements RTPDataReceiver.
    void receiveRtpData(char*, int len, erizo::DataType, uint32_t streamId);

private:
    void closeAll();
    uint32_t addVideoOutput(int payloadType, bool nack, bool fec);

    woogeen_base::FrameFormat m_incomingVideoFormat;
    boost::shared_ptr<woogeen_base::WebRTCTaskRunner> m_taskRunner;
    int m_videoOutputKbps;
    boost::shared_mutex m_videoOutputMutex;
    std::map<int, boost::shared_ptr<woogeen_base::VideoFrameSender>> m_videoOutputs;
    boost::shared_mutex m_videoTranscoderMutex;
    std::vector<boost::shared_ptr<woogeen_base::VideoFrameTranscoder>> m_videoTranscoders;

    // TODO: Currently we use the audio mixer to do transcoding, i.e, an audio
    // mixer with just one source input.
    // We may need to consider unifying the AudioMixer and AudioExternalOutput if possible.
    boost::scoped_ptr<AudioMixer> m_audioTranscoder;

    std::string m_participantId;
    boost::shared_ptr<erizo::MediaSource> m_publisher;
    boost::shared_mutex m_subscriberMutex;
    std::map<std::string, boost::shared_ptr<erizo::MediaSink>> m_subscribers;
    boost::shared_mutex m_sinkMutex;

    // TODO: Use it for async event notification from the worker thread to the main node thread.
    boost::shared_ptr<woogeen_base::EventRegistry> m_asyncHandler;
};

} /* namespace mcu */

#endif /* ExternalInputGateway_h */