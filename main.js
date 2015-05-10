var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);

http.listen(3000, function() {
  console.log('listening on *:3000');
});

app.use(express.static('client'));

var maxUsersByRoom = 10;
var minUserForGame = 3;
var maxTimeWaiting = 1000000;
var maxTimeStartGame = 3000;
var timerBetweenRound = [4000, 3000, 3000, 3000, 2000, 2000, 1000];

var rooms = [];

function newRoom(idRoom) {
    rooms[idRoom] = {};
    rooms[idRoom].id = idRoom;
    rooms[idRoom].deads = [];
    rooms[idRoom].sockets = [];
    rooms[idRoom].isComplete = false;
    rooms[idRoom].dateCreation = new Date();
    rooms[idRoom].isLaunching = false;
    rooms[idRoom].dateGameStart = null;
    rooms[idRoom].idRound = 0;
    rooms[idRoom].userWanted = -1;
    rooms[idRoom].squats = [];
}

function newDead(socket, idUser, idKey) {
  rooms[socket.idRoom].deads[idUser] = true;
  var dead = 'dead';
  if (idKey == 1)
    dead += 'Left';
  else if (idKey == 3)
    dead += 'Right';
  sendMessage(socket.idRoom, dead, idUser);
}

function nextUser(idRoom, idUser, left) {
  var room = rooms[idRoom];
  if (left) {
    for (var i = idUser - 1; i > 0; --i) {
      if (!room.deads[i])
        return i;
    }
    for (var i = room.sockets.length - 1; i > idUser; --i) {
      if (!room.deads[i])
        return i;
    }
  } else {
    for (var i = idUser; i < room.sockets.length; --i) {
      if (!room.deads[i])
        return i;
    }
    for (var i = 0; i < idUser; ++i) {
      if (!room.deads[i])
        return i;
    }
  }
  return -1;
}

function numberUsers(idRoom) {
  var room = rooms[idRoom];
  var cpt = 0;
  for (var i = 0; i < room.sockets.length; ++i) {
    if (room.sockets[i] != null)
      ++cpt;
  }
  return cpt;
}

function numberUsersAlive(idRoom) {
  var room = rooms[idRoom];
  var cpt = 0;
  for (var i = 0; i < room.sockets.length; ++i) {
    if (!room.deads[i])
      ++cpt;
  }
  return cpt;
}

function sendMessage(idRoom, idMessage, userInfos) {
  var room = rooms[idRoom];
  for (var i = 0; i < room.sockets.length; i++) {
    if (room.sockets[i] != null) {
      var socket = room.sockets[i];
      socket.emit(idMessage, {
        idRoom : idRoom,
        userInfos : userInfos
      });
    }
  }
}

io.on('connection', function(socket) {
  var idRoom = rooms.length - 1;
  if (idRoom < 0 || rooms[idRoom].isComplete || rooms[idRoom].isLaunching) {
    ++idRoom;
    newRoom(idRoom);
  }
  var idUser = rooms[idRoom].sockets.length;
  rooms[idRoom].deads[idUser] = false;
  rooms[idRoom].squats[idUser] = false;
  rooms[idRoom].sockets[idUser] = socket;
  if (numberUsers(idRoom) == maxUsersByRoom)
    rooms[idRoom].isComplete = true;

  socket.idUser = idUser;
  socket.idRoom = idRoom;
  console.log('connect ' + numberUsers(socket.idRoom) + ' users in room ' + socket.idRoom);
  socket.emit('idRoom', socket.idRoom);
  socket.emit('idUser', socket.idUser);
  sendMessage(socket.idRoom, 'nbUsers', numberUsers(socket.idRoom));

  socket.on('disconnect', function() {
    var room = rooms[socket.idRoom];
    room.deads[idUser] = true;
    room.sockets[socket.idUser] = null;
    console.log('disconnect ' + numberUsers(socket.idRoom) + ' users in room ' + socket.idRoom);
    if (room.isLaunching)
      sendMessage(socket.idRoom, 'dead', socket.idUser);
    else
      sendMessage(socket.idRoom, 'nbUsers', numberUsers(socket.idRoom));
  });

  socket.on('keyDown', function(id) {
    console.log('keyDown ' + id);
    var room = rooms[socket.idRoom];
    if (id == 2) { // Squat
      room.squats[socket.idUser] = true;
      sendMessage(socket.idRoom, 'squat', socket.idUser);
    } else { // Fire
      if (room.userWanted == -1) {
        newDead(socket, socket.idUser, id);
      } else {
        if (room.userWanted == socket.idUser) {
          newDead(socket, socket.idUser, id);
        } else {
          var idUserFind = nextUser(socket.idRoom, socket.idUser, id == 0);
          if (idUserFind != -1) {
            if (idUserFind == room.userWanted) {
              if (!room.squats[room.userWanted]) {
                newDead(socket, room.userWanted, 0);
              } else {
                var idUserFind = nextUser(socket.idRoom, room.userWanted, id == 0);
                newDead(socket, idUserFind, 0);
              }
            } else {
              newDead(socket, socket.idUser, id);
            }
          }
        }
        room.userWanted = -1;
        ++room.idRound;
        if (room.idRound == timerBetweenRound.length)
          room.idRound = timerBetweenRound.length - 1;
      }
    }
  });

  socket.on('keyUp', function(id) {
      console.log('keyUp ' + id);
    var room = rooms[socket.idRoom];
    if (id == 2) { // Squat
      room.squats[socket.idUser] = false;
      sendMessage(socket.idRoom, 'up', socket.idUser);
    }
  });
});

updateRoom = function() {
  var currentDate = new Date();
  for (var i = 0; i < rooms.length; ++i) {
    var room = rooms[i];
    if (room.isLaunching) {
      // Game start
      if (room.userWanted == -1 && currentDate - room.dateGameStart >= timerBetweenRound[room.idRound]) {
        do {
          room.userWanted = Math.floor(Math.random() * room.sockets.length);
        } while (rooms[i].deads[room.userWanted])
        sendMessage(i, 'wanted', room.userWanted);
      } else if (numberUsersAlive(i) == 1) {
        var idUserAlive = -1;
        for (var j = 0; j < room.sockets.length; ++j) {
          if (!room.deads[j]) {
            idUserAlive = j;
            break;
          }
        }
        sendMessage(i, 'winner', idUserAlive);
      }
    } else {
      // Start the room
      if (room.isComplete || (numberUsers(i) >= minUserForGame && (currentDate - room.dateCreation) > maxTimeWaiting)) {
        console.log('room ' + i + ' is launching');
        room.isLaunching = true;
        room.dateGameStart = currentDate;
        for (var j = 0; j < room.sockets.length; ++j) {
          var socket = room.sockets[i];
          if (socket != null) {
            socket.emit('start', socket.idRoom);
          }
        }
      }
    }
  }
}

setInterval(updateRoom, 100);