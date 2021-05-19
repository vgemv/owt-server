// Copyright (C) <2019> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

'use strict';
var mongoose = require('mongoose');
var Fraction = require('fraction.js');
var Schema = mongoose.Schema;
var Layout = require('./layoutTemplate');
var DefaultUtil = require('../defaults');
var cipher = require('../../cipher');

var ColorRGB = {
  type: Number,
  min: 0,
  max: 255,
  default: 0
};

var RNumber = {
  type: String,
  validate: {
    validator: function(v) {
      try {
        new Fraction(v);
      } catch (e) {
        return false;
      }
      return true;
    },
    message: '{VALUE} is not a valid fraction string!'
  },
  required: true
};

var Region = {
  _id: false,
  id: { type: String, required: true },
  shape: { type: String, enum: ['rectangle'], default: 'rectangle' },
  area: {
    left: RNumber,
    top: RNumber,
    width: RNumber,
    height: RNumber
  }
};

var Resolution = {
  width: { type: Number, default: 640 },
  height: { type: Number, default: 480 }
};

var AudioSchema = new Schema({
  codec: { type: String },
  sampleRate: { type: Number },
  channelNum: { type: Number }
},
{ _id: false });

var VideoSchema = new Schema({
  codec: { type: String },
  profile: { type: String }
},
{ _id: false });

var ViewSchema = new Schema({
  label: { type: String, default: 'common' },
  audio: {
    format: { type: AudioSchema, default: DefaultUtil.AUDIO_OUT[0] },
    vad: { type: Boolean, default: true },
  },
  video: {
    format: { type: VideoSchema, default: DefaultUtil.VIDEO_OUT[0] },
    parameters: {
      resolution: Resolution,
      framerate: { type: Number, default: 24 },
      bitrate: { type: Number },
      keyFrameInterval: { type: Number, default: 100 },
    },
    maxInput: { type: Number, default: 16, min: 1, max: 256 },
    motionFactor: { type: Number, default: 0.8 },
    bgColor: { r: ColorRGB, g: ColorRGB, b: ColorRGB },
    bgImageData: { type: Schema.Types.ObjectId, ref: 'Image' },                         // 背景图
    bgImageUri: { type: String },                         // 背景图地址
    overlays: [ { type: Schema.Types.ObjectId, ref: 'Overlay' } ],
    layoutEffect: { type: String },                       // 转场效果
    keepActiveInputPrimary: { type: Boolean, default: false },
    layout: {
      //TODO: stretched?
      fitPolicy: { type: String, enum: ['letterbox', 'crop'], default: 'letterbox' },
      setRegionEffect: { type: String },
      templates: {
        base: { type: String, enum: ['fluid', 'lecture', 'void'], default: 'fluid' },
        custom: [{
          _id: false,
          primary: { type: String },
          region: [ Region ]
        }]
      }
    }
  }
},
{ _id: false });

var OverlaySchema = new Schema({
  name:  { type: String, require: true },
  imageData: { type: Schema.Types.ObjectId, ref: 'Image' }, // 默认图片
  imageUri:  { type: String, require: true },
  type:  { type: String, require: true }, // 文字类型标记为 text, 图片为 image
  z:  { type: Number, require: true },
  x:  { type: Number, require: true },
  y:  { type: Number, require: true },
  width:  { type: Number, require: true },
  height:  { type: Number, require: true },
  disabled:  { type: Boolean, default: false }
});

var ImageSchema = new Schema({
  data:  { type: Buffer, require: true },
  type:  { type: String }, // 文字类型标记为 text, 图片为 image
  width:  { type: Number },
  height:  { type: Number },
  size:  { type: Number }
});

var StaticParticipantSchema = new Schema({
  name: { type: String, require: true },
  avatarData: { type: Schema.Types.ObjectId, ref: 'Image' }, // 默认图片
  avatarUri: { type: String }, // 默认图片url
  overlays: [ { type: Schema.Types.ObjectId, ref: 'Overlay' } ],
  user: { type: String, require: true },
  role: { type: String, require: true },
  permission: {
    publish: {
      video: { type: Boolean, default: true },
      audio: { type: Boolean, default: true }
    },
    subscribe: {
      video: { type: Boolean, default: true },
      audio: { type: Boolean, default: true }
    }
  },
  disabled:  { type: Boolean, default: false }
},
{ _id: false });


var SceneSchema = new Schema({
  name: { type: String, require: true },
  bgColor: { r: ColorRGB, g: ColorRGB, b: ColorRGB },
  bgImageData: { type: Schema.Types.ObjectId, ref: 'Image' },                         // 背景图
  bgImageUri: { type: String },                         // 背景图地址
  preview: { type: Schema.Types.ObjectId, ref: 'Image' }, // 默认图片
  overlays: [ { type: Schema.Types.ObjectId, ref: 'Overlay' } ],
  layout: {
    //TODO: stretched?
    fitPolicy: { type: String, enum: ['letterbox', 'crop'], default: 'letterbox' },
    setRegionEffect: { type: String },
    templates: {
      base: { type: String, enum: ['fluid', 'lecture', 'void'], default: 'fluid' },
      custom: [{
        _id: false,
        primary: { type: String },
        region: [ Region ]
      }]
    }
  }
});

var OverlayTemplateSchema = new Schema({
  name: { type: String, require: true },
  editable: { type: Boolean },
  overlays: [ { type: Schema.Types.ObjectId, ref: 'OverlayTemplate' } ]
});

var RoomSchema = new Schema({
  name: {
    type: String,
    required: true
  },
  inputLimit: {
    type: Number,
    default: -1
  },
  participantLimit: {
    type: Number,
    default: -1
  },
  selectActiveAudio: {
    type: Boolean,
    default: false
  },
  roles: [],
  staticParticipants: [ StaticParticipantSchema ],
  scenes: [ SceneSchema ],
  views: [ ViewSchema ],
  mediaIn: {
    audio: [],
    video: []
  },
  mediaOut: {
    audio: [],
    video: {
      format: [],
      parameters: {
        resolution: [],
        framerate: [],
        bitrate: [],
        keyFrameInterval: []
      }
    }
  },
  transcoding: {
    audio: { type: Boolean, default: true },
    video: {
      format: { type: Boolean, default: true },
      parameters: {
        resolution: { type: Boolean, default: true },
        framerate: { type: Boolean, default: true },
        bitrate: { type: Boolean, default: true },
        keyFrameInterval: { type: Boolean, default: true }
      }
    }
  },
  sip: {
    sipServer: String,
    username: String,
    password: {
      type: String,
      set: (v) => {
        return cipher.encrypt(cipher.k, v);
      },
      get: (v) => {
        if (!v)
          return v;
        let ret = '';
        try {
          ret = cipher.decrypt(cipher.k, v);
        } catch (e) {}
        return ret;
      }
    }
  },
  notifying: {
    participantActivities: { type: Boolean, default: true },
    streamChange: { type: Boolean, default: true }
  }
});

RoomSchema.set('toObject', { getters: true });

RoomSchema.statics.ViewSchema = mongoose.model('View', ViewSchema);
RoomSchema.statics.ImageSchema = mongoose.model('Image', ImageSchema);
RoomSchema.statics.OverlaySchema = mongoose.model('Overlay', OverlaySchema);
RoomSchema.statics.OverlayTemplateSchema = mongoose.model('OverlayTemplate', OverlayTemplateSchema);

RoomSchema.statics.processLayout = function(room) {
  if (room && room.views) {
    room.views.forEach(function (view) {
      if (view.video) {
        view.video.layout.templates = Layout.applyTemplate(
          view.video.layout.templates.base,
          view.video.maxInput,
          view.video.layout.templates.custom);
      }
    });
  }
  return room;
};

module.exports = mongoose.model('Room', RoomSchema);
