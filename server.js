var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var port = 80;

http.listen(process.env.PORT || port, function() {
  console.log('listening on *:' + process.env.PORT + ' or *:' + port);
});

app.use(express.static('client'));

var timerUpdate = 200;
var timerPing = 500;
var maxTimePing = 10000;
var maxUsersByRoom = 10;
var minUserForGame = 3;
var maxTimeWaiting = 10000;

var rooms = [];

function newRoom(idRoom) {
    rooms[idRoom] = {};
    rooms[idRoom].id = idRoom;
    rooms[idRoom].deads = [];
    rooms[idRoom].sockets = [];
    rooms[idRoom].isComplete = false;
    rooms[idRoom].dateCreation = new Date();
    rooms[idRoom].timerIsDisable = true;
    rooms[idRoom].isLaunching = false;
    rooms[idRoom].dateGameStart = null;
    rooms[idRoom].userWanted = -1;
    rooms[idRoom].squats = [];
    rooms[idRoom].isFinish = false;
}

function newDead(idRoom, idUser, idKey) {
  rooms[idRoom].deads[idUser] = true;
  var dead = 'dead';
  if (idKey == 1)
    dead += 'Left';
  else if (idKey == 3)
    dead += 'Right';
  sendMessage(idRoom, dead, idUser, true);
}

function newFire(idRoom, idUser, idKey) {
  var fire = 'fire';
  if (idKey == 1)
    fire += 'Left';
  else if (idKey == 3)
    fire += 'Right';
  sendMessage(idRoom, fire, idUser, true);
}

function nextUser(idRoom, idUser, left) {
  var room = rooms[idRoom];
  if (left) {
    for (var i = idUser - 1; i > -1; --i) {
      if (!room.deads[i])
        return i;
    }
    for (var i = room.deads.length - 1; i > idUser; --i) {
      if (!room.deads[i])
        return i;
    }
  } else {
    for (var i = idUser + 1; i < room.deads.length; ++i) {
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
  for (var i = 0; i < room.deads.length; ++i) {
    if (!room.deads[i])
      ++cpt;
  }
  return cpt;
}

function sendMessage(idRoom, idMessage, userInfos, log) {
  if (log) {
    console.log(new Date() + ' ' + idMessage + ' ' + userInfos + ' in room ' + idRoom);
  }
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

function updatePing(socket) {
    if (new Date() - socket.previousDate > maxTimePing) {
      if (socket.idRoom != -1) {
        var room = rooms[socket.idRoom];
        if (!room.deads[socket.idUser]) {
          room.deads[socket.idUser] = true;
          room.sockets[socket.idUser] = null;
          console.log(new Date() + ' disconnect ping dead ' + numberUsers(socket.idRoom) + ' users in room ' + socket.idRoom);
          newDead(socket.idRoom, socket.idUser, 0);
        }
      }
      clearInterval(socket.intervalId);
      socket.disconnect();
    } else {
      socket.emit('ping');
    }
} 

io.on('connection', function(socket) {
  socket.idRoom = -1;
  socket.idUser = -1;
  socket.previousDate = new Date();

  /*socket.intervalId = setInterval(function() {
    updatePing(socket);
  }, timerPing);

  socket.on('pong', function() {
    socket.previousDate = new Date();
  });*/

  socket.on('addUser', function() {
    var idRoom = rooms.length - 1;
    if (idRoom < 0 || rooms[idRoom].isComplete || rooms[idRoom].isLaunching) {
      ++idRoom;
      newRoom(idRoom);
    }
    var idUser = -1;
    for (var i = 0; i < rooms[idRoom].sockets.length; ++i) {
      if (rooms[idRoom].sockets[i] == null) {
        idUser = i;
      }
    }
    var room = rooms[idRoom];
    if (idUser == -1)
      idUser = room.sockets.length;
    room.deads[idUser] = false;
    room.squats[idUser] = false;
    room.sockets[idUser] = socket;
    if (numberUsers(idRoom) == maxUsersByRoom)
      room.isComplete = true;
    room.dateCreation = new Date();

    socket.idUser = idUser;
    socket.idRoom = idRoom;
    console.log(new Date() + ' connect ' + socket.idUser + ' ' + numberUsers(socket.idRoom) + ' users in room ' + socket.idRoom);
    socket.emit('idUser', {
      nbUsers : numberUsers(socket.idRoom),
      idUser : socket.idUser
    });
    sendMessage(socket.idRoom, 'nbUsers', numberUsers(socket.idRoom), false);
  });

  socket.on('disconnect', function() {
    if (socket.idRoom != -1) {
      var room = rooms[socket.idRoom];
      room.deads[socket.idUser] = true;
      room.sockets[socket.idUser] = null;
      if (room.isLaunching) {
        console.log(new Date() + ' disconnect dead ' + numberUsers(socket.idRoom) + ' users in room ' + socket.idRoom);
        newDead(socket.idRoom, socket.idUser, 0);
      } else {
        console.log(new Date() + ' disconnect ' + numberUsers(socket.idRoom) + ' users in room ' + socket.idRoom);
        sendMessage(socket.idRoom, 'nbUsers', numberUsers(socket.idRoom), false);
      }
    }
  });

  socket.on('keyDown', function(id) {
    if (socket.idRoom != -1) {
      var room = rooms[socket.idRoom];
      if (!room.deads[socket.idUser]) {
        if (id == 2) { // Squat
          if (room.userWanted == socket.idUser) {
            room.squats[socket.idUser] = true;
            sendMessage(socket.idRoom, 'squat', socket.idUser, true);
          } else {
            sendMessage(socket.idRoom, 'missSquat', socket.idUser, true);
          }
        } else { // Fire
          if (room.userWanted == -1) {
            newDead(socket.idRoom, socket.idUser, id);
          } else {
            if (room.userWanted == socket.idUser) {
              newDead(socket.idRoom, socket.idUser, id);
            } else {
              var idUserFind = nextUser(socket.idRoom, socket.idUser, id == 1);
              if (idUserFind != -1) {
                if (idUserFind == room.userWanted) {
                  if (!room.squats[room.userWanted]) {
                    newDead(socket.idRoom, room.userWanted, 0);
                  } else {
                    var idUserFind = nextUser(socket.idRoom, room.userWanted, id == 1);
                    newDead(socket.idRoom, idUserFind, 0);
                  }
                  newFire(socket.idRoom, socket.idUser, id);
                  sendMessage(socket.idRoom, 'delayStay', socket.idUser, true);
                } else {
                  newDead(socket.idRoom, socket.idUser, id);
                }
              }
            }
            room.userWanted = -1;
          }
        }
      }
    }
  });

  socket.on('keyUp', function(id) {
    if (socket.idRoom != -1) {
      var room = rooms[socket.idRoom];
      if (!room.deads[socket.idUser]) {
        if (id == 2) { // Squat
          if (socket.idUser == room.userWanted) {
            room.squats[socket.idUser] = false;
            sendMessage(socket.idRoom, 'stay', socket.idUser, true);
          } else {
            sendMessage(socket.idRoom, 'delayStay', socket.idUser, true);
          }
        }
      }
    }
  });
});

updateRoom = function() {
  var currentDate = new Date();
  for (var i = 0; i < rooms.length; ++i) {
    var room = rooms[i];
    if (room.isLaunching) {
      if (!room.isFinish) {
        // Game start
        if (room.userWanted == -1) {
          do {
            room.userWanted = Math.floor(Math.random() * room.sockets.length);
          } while (rooms[i].deads[room.userWanted])
          sendMessage(i, 'wanted', room.userWanted, true);
        } else if (numberUsersAlive(i) == 1) {
          var idUserAlive = -1;
          for (var j = 0; j < room.sockets.length; ++j) {
            if (!room.deads[j]) {
              idUserAlive = j;
              break;
            }
          }
          room.isFinish = true;
          if (idUserAlive != -1)
            sendMessage(i, 'winner', idUserAlive, true);
        }
      }
    } else {
      // Start the room
      var timePassed = maxTimeWaiting - (currentDate - room.dateCreation);
      if (numberUsers(i) >= minUserForGame) {
        room.timerIsDisable = false;
        sendMessage(i, 'timerWaitingPlayers', timePassed / 1000, false);
      } else {
        room.dateCreation = new Date();
        if (!room.timerIsDisable) {
          sendMessage(i, 'timerWaitingRemove', "", false);
        }
        room.timerIsDisable = true;
      }
      if (room.isComplete || (numberUsers(i) >= minUserForGame && timePassed <= 0)) {
        console.log(new Date() + ' room ' + i + ' is launching');
        room.isLaunching = true;
        room.dateGameStart = currentDate;
        sendMessage(i, 'start', "", true);
      }
    }
  }
}

setInterval(updateRoom, timerUpdate);