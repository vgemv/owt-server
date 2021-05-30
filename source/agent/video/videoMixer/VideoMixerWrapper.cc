// Copyright (C) <2019> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

#ifndef BUILDING_NODE_EXTENSION
#define BUILDING_NODE_EXTENSION
#endif

#include "VideoMixerWrapper.h"
#include "VideoLayout.h"

using namespace v8;

Persistent<Function> VideoMixer::constructor;
VideoMixer::VideoMixer() {};
VideoMixer::~VideoMixer() {};

void VideoMixer::Init(Handle<Object> exports, Handle<Object> module) {
  Isolate* isolate = exports->GetIsolate();
  // Prepare constructor template
  Local<FunctionTemplate> tpl = FunctionTemplate::New(isolate, New);
  tpl->SetClassName(String::NewFromUtf8(isolate, "VideoMixer"));
  tpl->InstanceTemplate()->SetInternalFieldCount(1);
  // Prototype
  NODE_SET_PROTOTYPE_METHOD(tpl, "close", close);
  NODE_SET_PROTOTYPE_METHOD(tpl, "addInput", addInput);
  NODE_SET_PROTOTYPE_METHOD(tpl, "setAvatar", setAvatar);
  NODE_SET_PROTOTYPE_METHOD(tpl, "removeInput", removeInput);
  NODE_SET_PROTOTYPE_METHOD(tpl, "setInputActive", setInputActive);
  NODE_SET_PROTOTYPE_METHOD(tpl, "addOutput", addOutput);
  NODE_SET_PROTOTYPE_METHOD(tpl, "removeOutput", removeOutput);
  NODE_SET_PROTOTYPE_METHOD(tpl, "updateLayoutSolution", updateLayoutSolution);
  NODE_SET_PROTOTYPE_METHOD(tpl, "updateSceneSolution", updateSceneSolution);
  NODE_SET_PROTOTYPE_METHOD(tpl, "updateInputOverlay", updateInputOverlay);
  NODE_SET_PROTOTYPE_METHOD(tpl, "forceKeyFrame", forceKeyFrame);
  NODE_SET_PROTOTYPE_METHOD(tpl, "drawText", drawText);
  NODE_SET_PROTOTYPE_METHOD(tpl, "clearText", clearText);

  constructor.Reset(isolate, tpl->GetFunction());
  module->Set(String::NewFromUtf8(isolate, "exports"), tpl->GetFunction());
}

void VideoMixer::New(const v8::FunctionCallbackInfo<v8::Value>& args) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);

  Local<Object> options = args[0]->ToObject(Nan::GetCurrentContext()).ToLocalChecked();
  mcu::VideoMixerConfig config;

  config.maxInput = options->Get(String::NewFromUtf8(isolate, "maxinput"))->Int32Value(Nan::GetCurrentContext()).ToChecked();
  config.crop = options->Get(String::NewFromUtf8(isolate, "crop"))->ToBoolean(Nan::GetCurrentContext()).ToLocalChecked()->BooleanValue();

  Local<Value> resolution = options->Get(String::NewFromUtf8(isolate, "resolution"));
  if (resolution->IsString()) {
    config.resolution = std::string(*String::Utf8Value(isolate, resolution->ToString()));
  }

  Local<Value> background = options->Get(String::NewFromUtf8(isolate, "backgroundcolor"));
  if (background->IsObject()) {
    Local<Object> colorObj = background->ToObject(Nan::GetCurrentContext()).ToLocalChecked();
    config.bgColor.r = colorObj->Get(String::NewFromUtf8(isolate, "r"))->Int32Value(Nan::GetCurrentContext()).ToChecked();
    config.bgColor.g = colorObj->Get(String::NewFromUtf8(isolate, "g"))->Int32Value(Nan::GetCurrentContext()).ToChecked();
    config.bgColor.b = colorObj->Get(String::NewFromUtf8(isolate, "b"))->Int32Value(Nan::GetCurrentContext()).ToChecked();
  }
  Local<Value> backgroundimage = options->Get(String::NewFromUtf8(isolate, "backgroundimage"));
  if (backgroundimage->IsObject()) {
    Local<Object> obj = backgroundimage->ToObject(Nan::GetCurrentContext()).ToLocalChecked();
    char* buffer = (char*) node::Buffer::Data(obj);
    const size_t size = node::Buffer::Length(obj);

    mcu::ImageData* imageData = new mcu::ImageData(size);
    config.bgImage.reset(imageData);
    memcpy(imageData->data, buffer, size);
  }

  config.useGacc = options->Get(String::NewFromUtf8(isolate, "gaccplugin"))->ToBoolean(Nan::GetCurrentContext()).ToLocalChecked()->BooleanValue();
  config.MFE_timeout = options->Get(String::NewFromUtf8(isolate, "MFE_timeout"))->Int32Value(Nan::GetCurrentContext()).ToChecked();

  VideoMixer* obj = new VideoMixer();
  obj->me = new mcu::VideoMixer(config);


  Local<Value> avatarsVal = options->Get(String::NewFromUtf8(isolate, "avatars"));//->ToObject(Nan::GetCurrentContext()).ToLocalChecked();
  if (avatarsVal->IsArray()) {
    Local<Object> avatars = avatarsVal->ToObject(Nan::GetCurrentContext()).ToLocalChecked();
    int length = avatars->Get(String::NewFromUtf8(isolate, "length"))->ToObject(Nan::GetCurrentContext()).ToLocalChecked()->Uint32Value(Nan::GetCurrentContext()).ToChecked();
    for (int i = 0; i < length; i++) {
      if (!avatars->Get(i)->IsObject())
        continue;
      Local<Object> imageObj = avatars->Get(i)->ToObject(Nan::GetCurrentContext()).ToLocalChecked();
      char* buffer = (char*) node::Buffer::Data(imageObj);
      const size_t size = node::Buffer::Length(imageObj);

      mcu::ImageData* imageData = new mcu::ImageData(size);
      memcpy(imageData->data, buffer, size);
      boost::shared_ptr<mcu::ImageData> image(imageData);
      obj->me->setAvatar(i, image);
    }
  }

  obj->Wrap(args.This());
  args.GetReturnValue().Set(args.This());
}

void VideoMixer::close(const v8::FunctionCallbackInfo<v8::Value>& args) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);
  VideoMixer* obj = ObjectWrap::Unwrap<VideoMixer>(args.Holder());
  mcu::VideoMixer* me = obj->me;

  obj->me = NULL;

  delete me;
}

void VideoMixer::addInput(const v8::FunctionCallbackInfo<v8::Value>& args) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);

  VideoMixer* obj = ObjectWrap::Unwrap<VideoMixer>(args.Holder());
  mcu::VideoMixer* me = obj->me;

  int inputIndex = args[0]->Int32Value(Nan::GetCurrentContext()).ToChecked();
  String::Utf8Value param1(isolate, args[1]->ToString());
  std::string codec = std::string(*param1);
  FrameSource* param2 = ObjectWrap::Unwrap<FrameSource>(args[2]->ToObject(Nan::GetCurrentContext()).ToLocalChecked());
  owt_base::FrameSource* src = param2->src;

  if(args[3]->IsString()){
      // Set avatar data
    String::Utf8Value param3(isolate, args[3]->ToString());
    std::string avatarData = std::string(*param3);
    int r = me->addInput(inputIndex, codec, src, avatarData);
    args.GetReturnValue().Set(Number::New(isolate, r));

  } else if(args[3]->IsObject()) {

    Local<Object> obj = args[3]->ToObject(Nan::GetCurrentContext()).ToLocalChecked();
    char* buffer = (char*) node::Buffer::Data(obj);
    const size_t size = node::Buffer::Length(obj);

    mcu::ImageData* imageData = new mcu::ImageData(size);
    boost::shared_ptr<mcu::ImageData> image(imageData);
    memcpy(imageData->data, buffer, size);

    int r = me->addInput(inputIndex, codec, src, image);

    args.GetReturnValue().Set(Number::New(isolate, r));
  } else {

    int r = me->addInput(inputIndex, codec, src, "");
    args.GetReturnValue().Set(Number::New(isolate, r));

  }


}

void VideoMixer::removeInput(const v8::FunctionCallbackInfo<v8::Value>& args) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);

  VideoMixer* obj = ObjectWrap::Unwrap<VideoMixer>(args.Holder());
  mcu::VideoMixer* me = obj->me;

  int inputIndex = args[0]->Int32Value(Nan::GetCurrentContext()).ToChecked();
  me->removeInput(inputIndex);
}

void VideoMixer::setAvatar(const v8::FunctionCallbackInfo<v8::Value>& args) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);

  VideoMixer* obj = ObjectWrap::Unwrap<VideoMixer>(args.Holder());
  mcu::VideoMixer* me = obj->me;

  int inputIndex = args[0]->Int32Value(Nan::GetCurrentContext()).ToChecked();
  if(args[1]->IsString()){
      // Set avatar data
    String::Utf8Value param3(isolate, args[1]->ToString());
    std::string avatarData = std::string(*param3);
    auto r = me->setAvatar(inputIndex, avatarData);
    args.GetReturnValue().Set(Boolean::New(isolate, r));

  } else if(args[1]->IsObject()) {

    Local<Object> obj = args[1]->ToObject(Nan::GetCurrentContext()).ToLocalChecked();
    char* buffer = (char*) node::Buffer::Data(obj);
    const size_t size = node::Buffer::Length(obj);

    mcu::ImageData* imageData = new mcu::ImageData(size);
    boost::shared_ptr<mcu::ImageData> image(imageData);
    memcpy(imageData->data, buffer, size);

    auto r = me->setAvatar(inputIndex, image);
    args.GetReturnValue().Set(Boolean::New(isolate, r));
  }
}

void VideoMixer::setInputActive(const v8::FunctionCallbackInfo<v8::Value>& args) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);

  VideoMixer* obj = ObjectWrap::Unwrap<VideoMixer>(args.Holder());
  mcu::VideoMixer* me = obj->me;

  int inputIndex = args[0]->Int32Value(Nan::GetCurrentContext()).ToChecked();
  bool active = args[1]->ToBoolean(Nan::GetCurrentContext()).ToLocalChecked()->Value();

  me->setInputActive(inputIndex, active);
}

void VideoMixer::addOutput(const v8::FunctionCallbackInfo<v8::Value>& args) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);

  VideoMixer* obj = ObjectWrap::Unwrap<VideoMixer>(args.Holder());
  mcu::VideoMixer* me = obj->me;

  String::Utf8Value param0(isolate, args[0]->ToString());
  std::string outStreamID = std::string(*param0);
  String::Utf8Value param1(isolate, args[1]->ToString());
  std::string codec = std::string(*param1);
  String::Utf8Value param2(isolate, args[2]->ToString());
  std::string resolution = std::string(*param2);
  unsigned int framerateFPS = args[3]->Uint32Value(Nan::GetCurrentContext()).ToChecked();
  unsigned int bitrateKbps = args[4]->Uint32Value(Nan::GetCurrentContext()).ToChecked();
  unsigned int keyFrameIntervalSeconds = args[5]->Uint32Value(Nan::GetCurrentContext()).ToChecked();
  FrameDestination* param6 = ObjectWrap::Unwrap<FrameDestination>(args[6]->ToObject(Nan::GetCurrentContext()).ToLocalChecked());
  owt_base::FrameDestination* dest = param6->dest;

  owt_base::VideoCodecProfile profile = owt_base::PROFILE_UNKNOWN;
  if (codec.find("h264") != std::string::npos) {
    if (codec == "h264_cb") {
      profile = owt_base::PROFILE_AVC_CONSTRAINED_BASELINE;
    } else if (codec == "h264_b") {
      profile = owt_base::PROFILE_AVC_BASELINE;
    } else if (codec == "h264_m") {
      profile = owt_base::PROFILE_AVC_MAIN;
    } else if (codec == "h264_e") {
      profile = owt_base::PROFILE_AVC_MAIN;
    } else if (codec == "h264_h") {
      profile = owt_base::PROFILE_AVC_HIGH;
    }
    codec = "h264";
  }
  bool r = me->addOutput(outStreamID, codec, profile, resolution, framerateFPS, bitrateKbps, keyFrameIntervalSeconds, dest);

  args.GetReturnValue().Set(Boolean::New(isolate, r));
}

void VideoMixer::removeOutput(const v8::FunctionCallbackInfo<v8::Value>& args) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);

  VideoMixer* obj = ObjectWrap::Unwrap<VideoMixer>(args.Holder());
  mcu::VideoMixer* me = obj->me;

  String::Utf8Value param0(isolate, args[0]->ToString());
  std::string outStreamID = std::string(*param0);

  me->removeOutput(outStreamID);
}

mcu::Rational parseRational(Isolate* isolate, Local<Value> rational) {
  mcu::Rational ret = { 0, 1 };
  if (rational->IsObject()) {
    Local<Object> obj = rational->ToObject(Nan::GetCurrentContext()).ToLocalChecked();
    ret.numerator = obj->Get(String::NewFromUtf8(isolate, "numerator"))->Int32Value(Nan::GetCurrentContext()).ToChecked();
    ret.denominator = obj->Get(String::NewFromUtf8(isolate, "denominator"))->Int32Value(Nan::GetCurrentContext()).ToChecked();
  }
  return ret;
}

void VideoMixer::updateLayoutSolution(const v8::FunctionCallbackInfo<v8::Value>& args) {
  Isolate* isolate = Isolate::GetCurrent();

  VideoMixer* obj = ObjectWrap::Unwrap<VideoMixer>(args.Holder());
  mcu::VideoMixer* me = obj->me;

  if (args.Length() < 1 || !args[0]->IsObject()) {
    args.GetReturnValue().Set(Boolean::New(isolate, false));
    return;
  }

  Local<Object> jsSolution = args[0]->ToObject(Nan::GetCurrentContext()).ToLocalChecked();
  if (jsSolution->IsArray()) {
    mcu::LayoutSolution solution;
    int length = jsSolution->Get(String::NewFromUtf8(isolate, "length"))->ToObject(Nan::GetCurrentContext()).ToLocalChecked()->Uint32Value(Nan::GetCurrentContext()).ToChecked();
    for (int i = 0; i < length; i++) {
      if (!jsSolution->Get(i)->IsObject())
        continue;
      Local<Object> jsInputRegion = jsSolution->Get(i)->ToObject(Nan::GetCurrentContext()).ToLocalChecked();
      int input = jsInputRegion->Get(String::NewFromUtf8(isolate, "input"))->NumberValue(Nan::GetCurrentContext()).ToChecked();
      Local<Object> regObj = jsInputRegion->Get(String::NewFromUtf8(isolate, "region"))->ToObject(Nan::GetCurrentContext()).ToLocalChecked();

      mcu::Region region;
      region.id = *String::Utf8Value(isolate, regObj->Get(String::NewFromUtf8(isolate, "id")));

      Local<Value> area = regObj->Get(String::NewFromUtf8(isolate, "area"));
      if (area->IsObject()) {
        Local<Object> areaObj = area->ToObject(Nan::GetCurrentContext()).ToLocalChecked();
        region.shape = *String::Utf8Value(isolate, regObj->Get(String::NewFromUtf8(isolate, "shape")));
        if (region.shape == "rectangle") {
          region.area.rect.left = parseRational(isolate, areaObj->Get(String::NewFromUtf8(isolate, "left")));
          region.area.rect.top = parseRational(isolate, areaObj->Get(String::NewFromUtf8(isolate, "top")));
          region.area.rect.width = parseRational(isolate, areaObj->Get(String::NewFromUtf8(isolate, "width")));
          region.area.rect.height = parseRational(isolate, areaObj->Get(String::NewFromUtf8(isolate, "height")));
        } else if (region.shape == "circle") {
          region.area.circle.centerW = parseRational(isolate, areaObj->Get(String::NewFromUtf8(isolate, "centerW")));
          region.area.circle.centerH = parseRational(isolate, areaObj->Get(String::NewFromUtf8(isolate, "centerH")));
          region.area.circle.radius = parseRational(isolate, areaObj->Get(String::NewFromUtf8(isolate, "radius")));
        }
      }

      mcu::InputRegion inputRegion = { input, region };
      solution.push_back(inputRegion);
    }
    me->updateLayoutSolution(solution);
    args.GetReturnValue().Set(Boolean::New(isolate, true));
  } else {
    args.GetReturnValue().Set(Boolean::New(isolate, false));
  }
}

void VideoMixer::updateSceneSolution(const v8::FunctionCallbackInfo<v8::Value>& args) {
  Isolate* isolate = Isolate::GetCurrent();

  VideoMixer* obj = ObjectWrap::Unwrap<VideoMixer>(args.Holder());
  mcu::VideoMixer* me = obj->me;

  if (args.Length() < 1 || !args[0]->IsObject()) {
    args.GetReturnValue().Set(Boolean::New(isolate, false));
    return;
  }

  Local<Object> jsSolution = args[0]->ToObject(Nan::GetCurrentContext()).ToLocalChecked();
  mcu::SceneSolution solution;

  Local<Value> jsBgImage = jsSolution->Get(String::NewFromUtf8(isolate, "bgImageData"));
  if (jsBgImage->IsObject()) {
    Local<Object> obj = jsBgImage->ToObject(Nan::GetCurrentContext()).ToLocalChecked();
    char* buffer = (char*) node::Buffer::Data(obj);
    const size_t size = node::Buffer::Length(obj);

    mcu::ImageData* imageData = new mcu::ImageData(size);
    solution.bgImage.reset(imageData);
    memcpy(imageData->data, buffer, size);
  }

  if(jsSolution->Has(String::NewFromUtf8(isolate, "layout"))) { 
    Local<Object> jsLayoutSolution = jsSolution->Get(String::NewFromUtf8(isolate, "layout"))->ToObject(Nan::GetCurrentContext()).ToLocalChecked();
    if (jsLayoutSolution->IsArray()) {
      solution.layout.reset(new mcu::LayoutSolution());
      int length = jsLayoutSolution->Get(String::NewFromUtf8(isolate, "length"))->ToObject(Nan::GetCurrentContext()).ToLocalChecked()->Uint32Value(Nan::GetCurrentContext()).ToChecked();
      for (int i = 0; i < length; i++) {
        if (!jsLayoutSolution->Get(i)->IsObject())
          continue;
        Local<Object> jsInputRegion = jsLayoutSolution->Get(i)->ToObject(Nan::GetCurrentContext()).ToLocalChecked();
        int input = jsInputRegion->Get(String::NewFromUtf8(isolate, "input"))->NumberValue(Nan::GetCurrentContext()).ToChecked();
        Local<Object> regObj = jsInputRegion->Get(String::NewFromUtf8(isolate, "region"))->ToObject(Nan::GetCurrentContext()).ToLocalChecked();

        mcu::Region region;
        region.id = *String::Utf8Value(isolate, regObj->Get(String::NewFromUtf8(isolate, "id")));

        Local<Value> area = regObj->Get(String::NewFromUtf8(isolate, "area"));
        if (area->IsObject()) {
          Local<Object> areaObj = area->ToObject(Nan::GetCurrentContext()).ToLocalChecked();
          region.shape = *String::Utf8Value(isolate, regObj->Get(String::NewFromUtf8(isolate, "shape")));
          if (region.shape == "rectangle") {
            region.area.rect.left = parseRational(isolate, areaObj->Get(String::NewFromUtf8(isolate, "left")));
            region.area.rect.top = parseRational(isolate, areaObj->Get(String::NewFromUtf8(isolate, "top")));
            region.area.rect.width = parseRational(isolate, areaObj->Get(String::NewFromUtf8(isolate, "width")));
            region.area.rect.height = parseRational(isolate, areaObj->Get(String::NewFromUtf8(isolate, "height")));
          } else if (region.shape == "circle") {
            region.area.circle.centerW = parseRational(isolate, areaObj->Get(String::NewFromUtf8(isolate, "centerW")));
            region.area.circle.centerH = parseRational(isolate, areaObj->Get(String::NewFromUtf8(isolate, "centerH")));
            region.area.circle.radius = parseRational(isolate, areaObj->Get(String::NewFromUtf8(isolate, "radius")));
          }
        }

        mcu::InputRegion inputRegion = { input, region };
        solution.layout->push_back(inputRegion);
      }
    }
  }

  if(jsSolution->Has(String::NewFromUtf8(isolate, "overlays"))) { 
    Local<Object> overlays = jsSolution->Get(String::NewFromUtf8(isolate, "overlays"))->ToObject(Nan::GetCurrentContext()).ToLocalChecked();
    if (overlays->IsArray()) {
      solution.overlays.reset(new std::vector<mcu::Overlay>());
      int length = overlays->Get(String::NewFromUtf8(isolate, "length"))->ToObject(Nan::GetCurrentContext()).ToLocalChecked()->Uint32Value(Nan::GetCurrentContext()).ToChecked();
      for (int i = 0; i < length; i++) {
        if (!overlays->Get(i)->IsObject())
          continue;
        Local<Object> overlay = overlays->Get(i)->ToObject(Nan::GetCurrentContext()).ToLocalChecked();
        
        mcu::Overlay overlayItem;
        
        if(overlay->Has(String::NewFromUtf8(isolate, "z")))
          overlayItem.z = overlay->Get(String::NewFromUtf8(isolate, "z"))->Int32Value(Nan::GetCurrentContext()).ToChecked();
        if(overlay->Has(String::NewFromUtf8(isolate, "x")))
          overlayItem.x = overlay->Get(String::NewFromUtf8(isolate, "x"))->NumberValue(Nan::GetCurrentContext()).ToChecked();
        if(overlay->Has(String::NewFromUtf8(isolate, "y")))
          overlayItem.y = overlay->Get(String::NewFromUtf8(isolate, "y"))->NumberValue(Nan::GetCurrentContext()).ToChecked();
        if(overlay->Has(String::NewFromUtf8(isolate, "width")))
          overlayItem.width = overlay->Get(String::NewFromUtf8(isolate, "width"))->NumberValue(Nan::GetCurrentContext()).ToChecked();
        if(overlay->Has(String::NewFromUtf8(isolate, "height")))
          overlayItem.height = overlay->Get(String::NewFromUtf8(isolate, "height"))->NumberValue(Nan::GetCurrentContext()).ToChecked();
        Local<Value> image = overlay->Get(String::NewFromUtf8(isolate, "imageData"));
        if (image->IsObject()) {
          Local<Object> obj = image->ToObject(Nan::GetCurrentContext()).ToLocalChecked();
          char* buffer = (char*) node::Buffer::Data(obj);
          const size_t size = node::Buffer::Length(obj);

          mcu::ImageData* imageData = new mcu::ImageData(size);
          overlayItem.image.reset(imageData);
          memcpy(imageData->data, buffer, size);
        }
        solution.overlays->push_back(overlayItem);
      }
    }
  }

  me->updateSceneSolution(solution);
  args.GetReturnValue().Set(Boolean::New(isolate, true));

}

void VideoMixer::updateInputOverlay(const v8::FunctionCallbackInfo<v8::Value>& args) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);

  VideoMixer* obj = ObjectWrap::Unwrap<VideoMixer>(args.Holder());
  mcu::VideoMixer* me = obj->me;

  int32_t inputId = args[0]->ToObject(Nan::GetCurrentContext()).ToLocalChecked()->Int32Value(Nan::GetCurrentContext()).ToChecked();
  std::vector<mcu::Overlay> overlays;

  // boost::shared_ptr<ImageData> image;
  // rtc::scoped_refptr<webrtc::VideoFrameBuffer> imageBuffer;
  // int z;
  // double x;
  // double y;
  // double width;
  // double height;
  // bool disabled;

  Local<Object> overlayObjs = args[1]->ToObject(Nan::GetCurrentContext()).ToLocalChecked();
  if (overlayObjs->IsArray()) {
    mcu::Overlay overlay;
    int length = overlayObjs->Get(String::NewFromUtf8(isolate, "length"))->ToObject(Nan::GetCurrentContext()).ToLocalChecked()->Uint32Value(Nan::GetCurrentContext()).ToChecked();
    for (int i = 0; i < length; i++) {
      if (!overlayObjs->Get(i)->IsObject())
        continue;
      Local<Object> overlayObj = overlayObjs->Get(i)->ToObject(Nan::GetCurrentContext()).ToLocalChecked();

      if(overlayObj->Has(String::NewFromUtf8(isolate, "imageData"))){
        // image
        Local<Object> imageObj = overlayObj->Get(String::NewFromUtf8(isolate, "imageData"))->ToObject(Nan::GetCurrentContext()).ToLocalChecked();
        char* buffer = (char*) node::Buffer::Data(imageObj);
        const size_t size = node::Buffer::Length(imageObj);

        mcu::ImageData* imageData = new mcu::ImageData(size);
        boost::shared_ptr<mcu::ImageData> image(imageData);
        memcpy(imageData->data, buffer, size);

        overlay.image = image;
      }

      // position

      if(overlayObj->Has(String::NewFromUtf8(isolate, "z")))
        overlay.z = overlayObj->Get(String::NewFromUtf8(isolate, "z"))->Int32Value(Nan::GetCurrentContext()).ToChecked();
      if(overlayObj->Has(String::NewFromUtf8(isolate, "x")))
        overlay.x = overlayObj->Get(String::NewFromUtf8(isolate, "x"))->NumberValue(Nan::GetCurrentContext()).ToChecked();
      if(overlayObj->Has(String::NewFromUtf8(isolate, "y")))
        overlay.y = overlayObj->Get(String::NewFromUtf8(isolate, "y"))->NumberValue(Nan::GetCurrentContext()).ToChecked();
      if(overlayObj->Has(String::NewFromUtf8(isolate, "width")))
        overlay.width = overlayObj->Get(String::NewFromUtf8(isolate, "width"))->NumberValue(Nan::GetCurrentContext()).ToChecked();
      if(overlayObj->Has(String::NewFromUtf8(isolate, "height")))
        overlay.height = overlayObj->Get(String::NewFromUtf8(isolate, "height"))->NumberValue(Nan::GetCurrentContext()).ToChecked();
      if(overlayObj->Has(String::NewFromUtf8(isolate, "disabled")))
        overlay.disabled = overlayObj->Get(String::NewFromUtf8(isolate, "disabled"))->BooleanValue(Nan::GetCurrentContext()).ToChecked();

      overlays.push_back(overlay);
    }
  }

  me->updateInputOverlay(inputId, overlays);
}

void VideoMixer::forceKeyFrame(const v8::FunctionCallbackInfo<v8::Value>& args) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);

  VideoMixer* obj = ObjectWrap::Unwrap<VideoMixer>(args.Holder());
  mcu::VideoMixer* me = obj->me;

  String::Utf8Value param0(isolate, args[0]->ToString());
  std::string outStreamID = std::string(*param0);

  me->forceKeyFrame(outStreamID);
}

void VideoMixer::drawText(const v8::FunctionCallbackInfo<v8::Value>& args) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);

  VideoMixer* obj = ObjectWrap::Unwrap<VideoMixer>(args.Holder());
  mcu::VideoMixer* me = obj->me;

  String::Utf8Value param0(isolate, args[0]->ToString());
  std::string textSpec = std::string(*param0);

  me->drawText(textSpec);
}

void VideoMixer::clearText(const v8::FunctionCallbackInfo<v8::Value>& args) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);

  VideoMixer* obj = ObjectWrap::Unwrap<VideoMixer>(args.Holder());
  mcu::VideoMixer* me = obj->me;

  me->clearText();
}

