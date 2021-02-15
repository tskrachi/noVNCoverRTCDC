"use strict";
var express = require('express');
var app = express();
var https = require('https');
var fs = require('fs');
var path = require('path');

var ssl_server_key = '../openssl/server.key';
var ssl_server_crt = '../openssl/server.crt';
var ssl_ca_crt     = '../openssl/RCA/ca.crt';
var port = 3002;

//app.use('/', express.static(path.join(__dirname, '../noVNC')));
app.use('/dc/', express.static(path.join(__dirname, '../noVNC_dc')));
//app.use(express.static(path.join(__dirname, '/scripts')));

var options = {
  key : fs.readFileSync(ssl_server_key)
  ,cert: fs.readFileSync(ssl_server_crt)
//  ,ca  : fs.readFileSync(ssl_ca_crt)
};

var server = https.createServer(options, app);
server.listen(port);
var io = require('socket.io')(server);

console.log('signaling server started on port:' + port);


// This callback function is called every time a socket
// tries to connect to the server
io.on('connection', function(socket) {
    // ---- multi room ----
    socket.on('enter', function(roomname) {
      socket.join(roomname);
      console.log('join room, id=' + socket.id + ' enter room=' + roomname);
      setRoomname(roomname);
    });

    function setRoomname(room) {
      socket.roomname = room;
    }

    function getRoomname() {
      var room = socket.roomname;
      return room;
    }

    function emitMessage(type, message) {
      // ----- multi room ----
      var roomname = getRoomname();

      if (roomname) {
        //console.log('===== message broadcast to room -->' + roomname);
        socket.broadcast.to(roomname).emit(type, message);
      }
      else {
        //console.log('===== message broadcast all');
        socket.broadcast.emit(type, message);
      }
    }

    // When a user send a SDP message
    // broadcast to all users in the room
    socket.on('message', function(message) {
        var date = new Date();
        message.from = socket.id;
        // console.log(date + 'id=' + socket.id + ' Received Message: ' + JSON.stringify(message));

        // get send target
        var target = message.sendto;
        if (target) {
          // console.log('===== message emit to -->' + target);
          socket.to(target).emit('message', message);
          return;
        }

        // broadcast in room
        emitMessage('message', message);
    });

    // When the user hangs up
    // broadcast bye signal to all users in the room
    socket.on('disconnect', function() {
        // close user connection
        console.log((new Date()) + ' Peer disconnected. id=' + socket.id);

        // --- emit ----
        emitMessage('user disconnected', {id: socket.id});

        // --- leave room --
        var roomname = getRoomname();
        if (roomname) {
          socket.leave(roomname);
        }
    });

});