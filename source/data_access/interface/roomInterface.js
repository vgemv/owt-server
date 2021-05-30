// Copyright (C) <2019> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

'use strict';
var mongoose = require('mongoose');
var Default = require('./../defaults');
var Room = require('./../model/roomModel');
var Service = require('./../model/serviceModel');

async function saveOverlaysToIds(overlays) {

  return await Promise.all(overlays.map(async item => {

    if(item.imageData && typeof(item.imageData) == "string"){
      let data = new Buffer(item.imageData, "base64");
      let image = new Room.ImageSchema({data});
      let savedImage = await image.save();
      item.imageData = savedImage._id;
    }

    let overlay = new Room.OverlaySchema(item);
    let saved = await overlay.save();
    return saved._id;
  }));
}

async function saveScenes(room) {

  room.scenes && room.scenes.map && await Promise.all(room.scenes.map(async item => {
    
      if(item.bgImageData && typeof(item.bgImageData) == "string"){
        let data = new Buffer(item.bgImageData, "base64");
        let image = new Room.ImageSchema({data});
        let savedImage = await image.save();
        item.bgImageData = savedImage._id;
      }
      if(item.preview && typeof(item.preview) == "string"){
        let data = new Buffer(item.preview, "base64");
        let image = new Room.ImageSchema({data});
        let savedImage = await image.save();
        item.preview = savedImage._id;
      }
      item.overlays = await saveOverlaysToIds(item.overlays);
  }))
}

async function saveStaticParticipants(room) {

  room.staticParticipants && room.staticParticipants.map && await Promise.all(room.staticParticipants.map(async item => {
    
      if(item.avatarData && typeof(item.avatarData) == "string"){
        let data = new Buffer(item.avatarData, "base64");
        let image = new Room.ImageSchema({data});
        let savedImage = await image.save();
        item.avatarData = savedImage._id;
      }
      if(item.preview && typeof(item.preview) == "string"){
        let data = new Buffer(item.preview, "base64");
        let image = new Room.ImageSchema({data});
        let savedImage = await image.save();
        item.preview = savedImage._id;
      }
      if(item.overlays)
        item.overlays = await saveOverlaysToIds(item.overlays);
  }))
}

function getAudioOnlyLabels(roomOption) {
  var labels = [];
  if (roomOption.views && roomOption.views.forEach) {
    roomOption.views.forEach((view) => {
      if (view.video === false) {
        labels.push(view.label);
      }
    });
  }
  return labels;
}

function checkMediaOut(room, roomOption) {
  var valid = true;
  var i;
  if (room && room.views) {
    room.views.forEach((view, vindex) => {
      if (!valid)
        return;

      i = room.mediaOut.audio.findIndex((afmt) => {
        return (afmt.codec === view.audio.format.codec
          && afmt.sampleRate === view.audio.format.sampleRate
          && afmt.channelNum === view.audio.format.channelNum);
      });
      if (i === -1) {
        valid = false;
        return;
      }

      if (roomOption.views && roomOption.views[vindex]
            && roomOption.views[vindex].video === false) {
        return;
      }

      i = room.mediaOut.video.format.findIndex((vfmt) => {
        return (vfmt.codec === view.video.format.codec
          && vfmt.profile === view.video.format.profile);
      });
      if (i === -1)
        valid = false;
    });
  }
  return valid;
}

function updateAudioOnlyViews(labels, room, callback) {
  if (room.views && room.views.map) {
    room.views = room.views.map((view) => {
      if (labels.indexOf(view.label) > -1) {
        view.video = false;
      }
      return view;
    });
  }
  room.save({validateBeforeSave: false}, function (err, raw) {
    if (err) return callback(err, null);
    callback(null, room.toObject());
  });
}

const removeNull = (obj) => {
  Object.keys(obj).forEach(key => {
    if (obj[key] && typeof obj[key] === 'object')
      removeNull(obj[key]);
    else if
      (obj[key] == null) delete obj[key];
  });
};

/*
 * Create Room.
 */
exports.create = async function (serviceId, roomOption, callback) {
  var attr;
  for (attr in Default.ROOM_CONFIG) {
    if (!roomOption[attr]) {
      roomOption[attr] = Default.ROOM_CONFIG[attr];
    }
  }

  removeNull(roomOption);

  try{
    await saveScenes(roomOption);
    await saveStaticParticipants(roomOption);
  }catch(e){
    callback(e, null);
  }

  var labels = getAudioOnlyLabels(roomOption);
  var room = new Room(roomOption);
  if (!checkMediaOut(room, roomOption)) {
    callback(new Error('MediaOut conflicts with View Setting'), null);
    return;
  }
  room.save().then((saved) => {
    Service.findById(serviceId).then((service) => {
      service.rooms.push(saved._id);
      service.save().then(() => {
        if (labels.length > 0) {
          updateAudioOnlyViews(labels, saved, callback);
        } else {
          callback(null, saved.toObject());
        }
      });
    });
  }).catch((err) => {
    callback(err, null);
  });
};

/*
 * List Rooms.
 */
exports.list = function (serviceId, options, callback) {
  var popOption = {
    path: 'rooms',
    options: { sort: {_id: 1} }
  };
  if (options) {
    if (typeof options.per_page === 'number' && options.per_page > 0) {
      popOption.options.limit = options.per_page;
      if (typeof options.page === 'number' && options.page > 0) {
        popOption.options.skip = (options.page - 1) * options.per_page;
      }
    }
  }

  Service.findById(serviceId).populate(popOption).exec(function (err, service) {
    if (err) {
      callback(err);
      return;
    }
    // Current mongoose version has problem with lean getters
    callback(null, service.rooms.map((room) => room.toObject()));
  });
};

/*
 * Get Room. Represents a determined room.
 */
exports.get = function (serviceId, roomId, callback) {
  Service.findById(serviceId).lean().exec(function (err, service) {
    
    if (err) return callback(err, null);

    var i, match = false;
    for (i = 0; i < service.rooms.length; i++) {
      if (service.rooms[i].toString() === roomId) {
        match = true;
        break;
      }
    }

    if (!match) return callback(null, null);
    
    Room.findById(roomId).lean().exec(function (err, room) {
        return callback(err, room);
    });
  });
};

exports.getScene = async function (serviceId, roomId, sceneId, callback) {
  try{
    let service = await Service.findById(serviceId).lean().exec();
    
    var i, match = false;
    for (i = 0; i < service.rooms.length; i++) {
      if (service.rooms[i].toString() === roomId) {
        match = true;
        break;
      }
    }

    if (!match) return callback(null, null);

    let room = await Room.findById(roomId).exec();

    let sceneIdx = room.scenes.findIndex(i => i._id == sceneId);

    room = await room.populate(`scenes.${sceneIdx}.bgImageData`).populate({path:`scenes.${sceneIdx}.overlays`,populate:"imageData"}).execPopulate();

    let scene = room.scenes[sceneIdx];

    if(scene)
      callback(null, scene.toObject());
    else
      callback(null, null);

  }catch(err){
    callback(err, null);
  }
};

exports.deleteScene = async function (serviceId, roomId, sceneId, callback) {
  try{
    let service = await Service.findById(serviceId).lean().exec();
    
    var i, match = false;
    for (i = 0; i < service.rooms.length; i++) {
      if (service.rooms[i].toString() === roomId) {
        match = true;
        break;
      }
    }

    if (!match) return callback(null, null);

    let room = await Room.findById(roomId).exec();

    let scene = room.scenes.find(i => i._id == sceneId);

    if (!scene) throw new Error("Scene not found");

    room.scenes = room.scenes.filter(i => i._id != sceneId);
    await room.save();

    // remove relative
    {
      // remove Image
      scene.preview && await Room.ImageSchema.deleteOne({_id: scene.preview}).exec();
      scene.bgImageData && await Room.ImageSchema.deleteOne({_id: scene.bgImageData}).exec();

      // remove Overlay
      if(scene.overlays){
        await Promise.all(scene.overlays.map(async i => {
          let overlay =  await Room.OverlaySchema.findById(i).exec();
          overlay.imageData && await Room.ImageSchema.deleteOne({_id: overlay.imageData}).exec();
          await Room.OverlaySchema.deleteOne({_id: overlay._id});
        }));
      }
    }


    callback(null, sceneId);

  }catch(err){
    callback(err, null);
  }
}
exports.updateScene = async function (serviceId, roomId, scene, callback) {
  try{
    let service = await Service.findById(serviceId).lean().exec();
    
    var i, match = false;
    for (i = 0; i < service.rooms.length; i++) {
      if (service.rooms[i].toString() === roomId) {
        match = true;
        break;
      }
    }

    if (!match) return callback(new Error("Room not found"), null);

    let room = await Room.findById(roomId).exec();

    let dbScene = room.scenes.find(i => i._id == scene._id);

    if(!dbScene) return callback(new Error("Scene not found"), null);

    let prepareRoom = {scenes:[scene]};
    await saveScenes(prepareRoom);

    Object.assign(dbScene, prepareRoom.scenes[0]);

    await room.save();
    let savedScene = prepareRoom.scenes[0];

    callback(null, savedScene);

  }catch(err){
    callback(err, null);
  }
}
exports.createScene = async function (serviceId, roomId, scene, callback) {
  try{
    let service = await Service.findById(serviceId).lean().exec();
    
    var i, match = false;
    for (i = 0; i < service.rooms.length; i++) {
      if (service.rooms[i].toString() === roomId) {
        match = true;
        break;
      }
    }

    if (!match) return callback(null, null);

    let room = await Room.findById(roomId).exec();

    if(scene._id)
      delete scene._id;

    let prepareRoom = {scenes:[scene]};
    await saveScenes(prepareRoom);

    room.scenes.push(prepareRoom.scenes[0]);

    let saved = await room.save();
    let savedScene = saved.scenes[saved.scenes.length - 1];
    
    callback(null, savedScene.toObject());

  }catch(err){
    callback(err, null);
  }
}

exports.listScene = function (serviceId, roomId, options, callback) {
  Service.findById(serviceId).lean().exec(function (err, service) {
    
    if (err) return callback(err, null);

    var i, match = false;
    for (i = 0; i < service.rooms.length; i++) {
      if (service.rooms[i].toString() === roomId) {
        match = true;
        break;
      }
    }

    if (!match) return callback(null, null);

    let start = 0;
    let end = undefined;
    if (options) {
      if (typeof options.per_page === 'number' && options.per_page > 0) {
        start = options.per_page;
        if (typeof options.page === 'number' && options.page > 0) {
          end = (options.page - 1) * options.per_page;
        }
      }
    }

    Room.findById(roomId).populate("scenes.preview").lean().exec(function (err, room) {
        return callback(err, room.scenes.slice(start, end));
    });
  });
};

exports.createStaticParticipant = async function (serviceId, roomId, staticParticipant, callback) {
  try{
    let service = await Service.findById(serviceId).lean().exec();
    
    var i, match = false;
    for (i = 0; i < service.rooms.length; i++) {
      if (service.rooms[i].toString() === roomId) {
        match = true;
        break;
      }
    }

    if (!match) throw new Error("Room not found");

    let room = await Room.findById(roomId).exec();

    if(staticParticipant._id)
      delete staticParticipant._id;

    let prepareRoom = {staticParticipants:[staticParticipant]};
    await saveStaticParticipants(prepareRoom);
    
    room.staticParticipants.push(prepareRoom.staticParticipants[0]);

    let saved = await room.save();
    let savedStaticParticipant = saved.staticParticipants[saved.staticParticipants.length - 1];

    callback(null, savedStaticParticipant.toObject());

  }catch(err){
    callback(err, null);
  }
}

exports.updateStaticParticipant = async function (serviceId, roomId, staticParticipantOption, callback) {
  try{
    let service = await Service.findById(serviceId).lean().exec();
    
    var i, match = false;
    for (i = 0; i < service.rooms.length; i++) {
      if (service.rooms[i].toString() === roomId) {
        match = true;
        break;
      }
    }

    if (!match) throw new Error("Room not found");

    let room = await Room.findById(roomId).exec();

    let staticParticipant = room.staticParticipants.find(i => i._id == staticParticipantOption._id);

    if (!staticParticipant) throw new Error("StaticParticipant not found");

    let prepareRoom = {staticParticipants:[staticParticipantOption]};
    await saveStaticParticipants(prepareRoom);

    Object.assign(staticParticipant, prepareRoom.staticParticipants[0]);

    await room.save();
    let savedStaticParticipant = prepareRoom.staticParticipants[0];

    callback(null, savedStaticParticipant);

  }catch(err){
    callback(err, null);
  }
}

exports.deleteStaticParticipant = async function (serviceId, roomId, staticParticipantId, callback) {
  try{
    let service = await Service.findById(serviceId).lean().exec();
    
    var i, match = false;
    for (i = 0; i < service.rooms.length; i++) {
      if (service.rooms[i].toString() === roomId) {
        match = true;
        break;
      }
    }

    if (!match) throw new Error("Room not found");

    let room = await Room.findById(roomId).exec();

    let staticParticipant = room.staticParticipants.find(i => i._id == staticParticipantId);

    if (!staticParticipant) throw new Error("StaticParticipant not found");

    room.staticParticipants = room.staticParticipants.filter(i => i._id != staticParticipantId);

    room.save();

    // remove relative
    {
      // remove Image
      staticParticipant.preview && await Room.ImageSchema.deleteOne({_id: staticParticipant.preview}).exec();
      staticParticipant.avatarData && await Room.ImageSchema.deleteOne({_id: staticParticipant.avatarData}).exec();

      // remove Overlay
      if(staticParticipant.overlays){
        await Promise.all(staticParticipant.overlays.map(async i => {
          let overlay =  await Room.OverlaySchema.findById(i).exec();
          overlay.imageData && await Room.ImageSchema.deleteOne({_id: overlay.imageData}).exec();
          await Room.OverlaySchema.deleteOne({_id: overlay._id});
        }));
      }
    }

    callback(null, staticParticipantId);

  }catch(err){
    callback(err, null);
  }
}

exports.getStaticParticipant = async function (serviceId, roomId, staticParticipantId, callback) {
  try{
    let service = await Service.findById(serviceId).lean().exec();
    
    var i, match = false;
    for (i = 0; i < service.rooms.length; i++) {
      if (service.rooms[i].toString() === roomId) {
        match = true;
        break;
      }
    }

    if (!match) throw new Error("Room not found");

    let room = await Room.findById(roomId).exec();

    let staticParticipantIdx = room.staticParticipants.findIndex(i => i._id == staticParticipantId);

    if (staticParticipantIdx == -1) throw new Error("StaticParticipant not found");

    room = await room
      .populate(`staticParticipants.${staticParticipantIdx}.avatarData`)
      .populate({path:`staticParticipants.${staticParticipantIdx}.overlays`,populate:"imageData"}).execPopulate();

    let staticParticipant = room.staticParticipants[staticParticipantIdx];

    callback(null, staticParticipant.toObject());

  }catch(err){
    callback(err, null);
  }
}

exports.listStaticParticipant = async function (serviceId, roomId, callback) {
  try{
    let service = await Service.findById(serviceId).lean().exec();
    
    var i, match = false;
    for (i = 0; i < service.rooms.length; i++) {
      if (service.rooms[i].toString() === roomId) {
        match = true;
        break;
      }
    }

    if (!match) throw new Error("Room not found");

    let room = await Room.findById(roomId).populate("staticParticipants.preview").exec();

    callback(null, room.staticParticipants.toObject());

  }catch(err){
    callback(err, null);
  }
  
}

/*
 * Delete Room. Removes a determined room from the data base.
 */
exports.delete = function (serviceId, roomId, callback) {
  Room.deleteOne({_id: roomId}, function(err0) {
    Service.findByIdAndUpdate(serviceId, { '$pull' : { 'rooms' : roomId } },
      function (err1, service) {
        if (err1) console.log('Pull rooms fail:', err1.message);
        callback(err0, roomId);
      });
  });
};

/*
 * Update Room. Update a determined room from the data base.
 */
exports.update = function (serviceId, roomId, updates, callback) {
  removeNull(updates);
  var labels = getAudioOnlyLabels(updates);
  Room.findById(roomId).then(async (room) => {

    var newRoom = Object.assign(room, updates);
    if (!checkMediaOut(newRoom, updates)) {
      throw new Error('MediaOut conflicts with View Setting');
    }

    await saveScenes(updates);

    return await newRoom.save();
  }).then((saved) => {
    if (labels.length > 0) {
      updateAudioOnlyViews(labels, saved, callback);
    } else {
      callback(null, saved.toObject());
    }
  }).catch((err) => {
    callback(err, null);
  });
};

/*
 * Get a room's configuration. Called by conference.
 */
exports.config = function (roomId) {
  return new Promise((resolve, reject) => {
    Room.findById(roomId)
    .populate("staticParticipants.avatarData")
    .populate({path:"staticParticipants.overlays",populate:"imageData"})
    .populate("scenes.bgImageData")
    .populate({path:"scenes.overlays",populate:"imageData"})
    .exec( function (err, room) {
      if (err || !room) {
        reject(err);
      } else {
        var config = Room.processLayout(room.toObject());
        resolve(config);
      }
    });
  });
};

/*
 * Get sip rooms. Called by sip portal.
 */
exports.sips = function () {
  return new Promise((resolve, reject) => {
    Room.find({'sip.sipServer': {$ne: null}}, function(err, rooms) {
      if (err || !rooms) {
        resolve([]);
      } else {
        var result = rooms.map((room) => {
          return { roomId: room._id.toString(), sip: room.sip };
        });
        resolve(result);
      }
    });
  });
};
