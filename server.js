const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const rooms = {};

// =============================================================
// ลำดับไพ่
// 2 < 3 < 4 < 5 < 6 < 7 < 8 < 9 < 10 < J < Q < K < A
// =============================================================
const CARD_RANKS = {
    '2': 1,
    '3': 2,
    '4': 3,
    '5': 4,
    '6': 5,
    '7': 6,
    '8': 7,
    '9': 8,
    '10': 9,
    'J': 10,
    'Q': 11,
    'K': 12,
    'A': 13
};

// =============================================================
// ลำดับดอกไพ่
// =============================================================
const SUIT_RANKS = {
    '♠': 1,
    '♥️': 2,
    '♣': 3,
    '♦️': 4
};

// =============================================================
// สร้างสำรับไพ่
// =============================================================
function createDeck() {
    const suits = ['♠', '♥️', '♣', '♦️'];
    const values = [
        '2', '3', '4', '5', '6', '7',
        '8', '9', '10', 'J', 'Q', 'K', 'A'
    ];

    let deck = [];

    for (let s of suits) {
        for (let v of values) {
            deck.push({
                suit: s,
                value: v
            });
        }
    }

    return deck.sort(() => Math.random() - 0.5);
}

// =============================================================
// คะแนนไพ่
// 5 = 5 คะแนน
// 10 = 10 คะแนน
// A = 10 คะแนน
// =============================================================
function calculateCardScore(card) {
    if (card.value === '5') return 5;
    if (card.value === '10' || card.value === 'A') return 10;
    return 0;
}

// =============================================================
// เรียงไพ่
// =============================================================
function sortCards(a, b) {
    if (SUIT_RANKS[a.suit] !== SUIT_RANKS[b.suit]) {
        return SUIT_RANKS[a.suit] - SUIT_RANKS[b.suit];
    }

    return CARD_RANKS[b.value] - CARD_RANKS[a.value];
}

// =============================================================
// สร้างห้อง
// =============================================================
function createRoomObject(roomId) {
    return {
        id: roomId,

        seats: [null, null, null, null],

        // 4P = ผู้เล่น 4 คน, 1V1 = ผู้เล่น 2 คนควบคุมคนละ 2 ที่นั่ง
        mode: '4P',
        controllerSeats: {},

        gameState: 'LOBBY',

        deck: [],

        hands: {},

        kitty: [],

        dealer: -1,

        bidTurn: -1,

        highestBid: 60,

        highestBidder: -1,

        consecutivePasses: 0,

        trumpSuit: null,

        teamAScore: 0,

        teamBScore: 0,

        teamACapturedCards: [],

        teamBCapturedCards: [],

        starterPlayer: -1,

        currentRoundCards: [null, null, null, null],

        roundCount: 0,

        // ไพ่ที่ออกไปแล้วทั้งหมด
        playedHistory: [],

        // จำว่าผู้เล่นแต่ละคนไม่มีดอกอะไร
        voidSuits: {
            0: [],
            1: [],
            2: [],
            3: []
        }
    };
}

// =============================================================
// 🎯 1 VS 1 / CONTROL HELPERS
// =============================================================
function getControlledSeats(room, socketId) {
    if (!room) return [];
    const seats = [];
    for (let i = 0; i < 4; i++) {
        const player = room.seats[i];
        if (player && player.id === socketId && !player.isAI) seats.push(i);
    }
    return seats;
}

function socketControlsSeat(room, socketId, seatIndex) {
    return getControlledSeats(room, socketId).includes(seatIndex);
}

function getControllerId(room, seatIndex) {
    const player = room.seats[seatIndex];
    return player ? player.id : null;
}

function sendControlledHands(room, socketId) {
    if (!room || !socketId) return;
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) return;
    const controlledSeats = getControlledSeats(room, socketId);
    const hands = {};
    controlledSeats.forEach(seat => {
        hands[seat] = room.hands[seat] || [];
    });
    if (controlledSeats.length === 1) {
        socket.emit('yourHand', hands[controlledSeats[0]] || []);
    }
    socket.emit('yourHands', {
        controlledSeats,
        hands
    });
}

function makePrivateGameState(room, socketId) {
    const view = { ...room };
    // ห้ามส่งไพ่ในมือทุกคนผ่าน updateGameState
    delete view.hands;
    delete view.deck;
    delete view.kitty;
    view.controlledSeats = getControlledSeats(room, socketId);
    view.mySeat = view.controlledSeats[0] ?? -1;
    return view;
}

function broadcastGameState(room) {
    if (!room) return;
    const sent = new Set();
    for (let i = 0; i < 4; i++) {
        const player = room.seats[i];
        if (!player || player.isAI || sent.has(player.id)) continue;
        const socket = io.sockets.sockets.get(player.id);
        if (socket) {
            socket.emit('updateGameState', makePrivateGameState(room, player.id));
            sendControlledHands(room, player.id);
            sent.add(player.id);
        }
    }
}

function fill1v1AIPair(room) {
    if (!room) return;
    room.mode = '1V1';
    // ทีมผู้เล่น = Seat 0,2 / ทีม AI = Seat 1,3
    const human = room.seats[0];
    if (!human) return;
    room.seats[2] = {
        id: human.id,
        name: human.name,
        isAI: false,
        seat: 2
    };
    room.seats[1] = {
        id: 'bot-1v1-1',
        name: 'บอท AI 1',
        isAI: true,
        seat: 1
    };
    room.seats[3] = {
        id: 'bot-1v1-3',
        name: 'บอท AI 2',
        isAI: true,
        seat: 3
    };
}

// =============================================================
// Socket.IO
// =============================================================
io.on('connection', (socket) => {

    // ---------------------------------------------------------
    // สร้างห้อง
    // ---------------------------------------------------------
    socket.on('createRoom', (playerName) => {

        const roomId =
            Math.floor(1000 + Math.random() * 9000).toString();

        rooms[roomId] = createRoomObject(roomId);

        rooms[roomId].seats[0] = {
            id: socket.id,
            name: playerName,
            isAI: false,
            seat: 0
        };

        socket.join(roomId);

        socket.emit('roomCreated', {
            roomId,
            seat: 0
        });

        io.to(roomId).emit(
            'updateRoom',
            rooms[roomId]
        );

        io.to(roomId).emit(
            'newChatMessage',
            {
                senderName: 'ระบบ',
                message: `🎉 คุณ ${playerName} สร้างห้องพักสำเร็จ`,
                isSystem: true
            }
        );
    });

    // ---------------------------------------------------------
    // สร้างเกมเล่นคนเดียว
    // ---------------------------------------------------------
    socket.on('createSinglePlayer', (playerName) => {

        const roomId =
            Math.floor(1000 + Math.random() * 9000).toString();

        const room = createRoomObject(roomId);

        room.seats[0] = {
            id: socket.id,
            name: playerName,
            isAI: false,
            seat: 0
        };

        for (let i = 1; i <= 3; i++) {

            room.seats[i] = {
                id: `bot-${i}`,
                name: `บอท AI ${i}`,
                isAI: true,
                seat: i
            };
        }

        rooms[roomId] = room;

        socket.join(roomId);

        socket.emit('roomCreated', {
            roomId,
            seat: 0
        });

        io.to(roomId).emit(
            'updateRoom',
            room
        );

        io.to(roomId).emit(
            'newChatMessage',
            {
                senderName: 'ระบบ',
                message: `🤖 เริ่มเกมโหมดเล่นกับบอทแล้ว`,
                isSystem: true
            }
        );
    });

    // ---------------------------------------------------------
    // สร้างเกม 1 VS 1 กับบอท
    // ผู้เล่นควบคุม Seat 0 + 2 / AI ควบคุม Seat 1 + 3
    // ---------------------------------------------------------
    socket.on('create1v1AI', (playerName) => {
        const roomId = Math.floor(1000 + Math.random() * 9000).toString();
        const room = createRoomObject(roomId);
        room.mode = '1V1';
        room.seats[0] = {
            id: socket.id,
            name: playerName || 'คุณ',
            isAI: false,
            seat: 0
        };
        fill1v1AIPair(room);
        rooms[roomId] = room;
        socket.join(roomId);
        socket.emit('roomCreated', {
            roomId,
            seat: 0,
            controlledSeats: [0, 2],
            mode: '1V1'
        });
        io.to(roomId).emit('updateRoom', room);
        io.to(roomId).emit('newChatMessage', {
            senderName: 'ระบบ',
            message: '🤖 เริ่มเกม 1 VS 1 กับบอท — คุณควบคุม Seat 1 + 3',
            isSystem: true
        });
    });

    // ---------------------------------------------------------
    // สร้างห้อง 1 VS 1 กับเพื่อน
    // ผู้สร้าง = Seat 0 + 2 / เพื่อน = Seat 1 + 3
    // ---------------------------------------------------------
    socket.on('create1v1Room', (playerName) => {
        const roomId = Math.floor(1000 + Math.random() * 9000).toString();
        const room = createRoomObject(roomId);
        room.mode = '1V1';
        room.seats[0] = {
            id: socket.id,
            name: playerName || 'ผู้เล่น 1',
            isAI: false,
            seat: 0
        };
        room.seats[2] = {
            id: socket.id,
            name: playerName || 'ผู้เล่น 1',
            isAI: false,
            seat: 2
        };
        rooms[roomId] = room;
        socket.join(roomId);
        socket.emit('roomCreated', {
            roomId,
            seat: 0,
            controlledSeats: [0, 2],
            mode: '1V1'
        });
        io.to(roomId).emit('updateRoom', room);
        io.to(roomId).emit('newChatMessage', {
            senderName: 'ระบบ',
            message: '👥 ห้อง 1 VS 1 สร้างแล้ว — เพื่อนจะควบคุม Seat 2 + 4',
            isSystem: true
        });
    });

    // ---------------------------------------------------------
    // เข้าห้อง
    // ---------------------------------------------------------
    socket.on('joinRoom', ({ roomId, playerName }) => {

        const room = rooms[roomId];

        if (!room) {
            return socket.emit(
                'errorMessage',
                'ไม่พบห้องนี้'
            );
        }

        let emptySeat;
        let controlledSeats;

        if (room.mode === '1V1') {
            // ห้อง 1 VS 1: คนที่สองควบคุม Seat 1 + 3
            if (room.seats[1] || room.seats[3]) {
                return socket.emit('errorMessage', 'ห้อง 1 VS 1 นี้มีผู้เล่นครบแล้ว');
            }
            room.seats[1] = { id: socket.id, name: playerName, isAI: false, seat: 1 };
            room.seats[3] = { id: socket.id, name: playerName, isAI: false, seat: 3 };
            controlledSeats = [1, 3];
            emptySeat = 1;
        } else {
            emptySeat = room.seats.findIndex(s => s === null);
            if (emptySeat === -1) {
                return socket.emit('errorMessage', 'ห้องเต็มแล้ว');
            }
            room.seats[emptySeat] = {
                id: socket.id,
                name: playerName,
                isAI: false,
                seat: emptySeat
            };
            controlledSeats = [emptySeat];
        }

        socket.join(roomId);

        socket.emit('joinedSuccess', {
            roomId,
            seat: emptySeat,
            controlledSeats,
            mode: room.mode
        });

        io.to(roomId).emit(
            'updateRoom',
            room
        );

        io.to(roomId).emit(
            'newChatMessage',
            {
                senderName: 'ระบบ',
                message: `👋 คุณ ${playerName} เข้าร่วมห้องแล้ว`,
                isSystem: true
            }
        );
    });

    // ---------------------------------------------------------
    // Chat
    // ---------------------------------------------------------
    socket.on('sendChatMessage', ({ roomId, message }) => {

        const room = rooms[roomId];

        if (!room) return;

        const player =
            room.seats.find(
                s => s && s.id === socket.id
            );

        const senderName =
            player ? player.name : 'ผู้รับชม';

        io.to(roomId).emit(
            'newChatMessage',
            {
                senderId: socket.id,
                senderName: senderName,
                message: message,
                isSystem: false
            }
        );
    });

    // ---------------------------------------------------------
    // เปลี่ยนที่นั่ง
    // ---------------------------------------------------------
    socket.on('changeSeat', ({ roomId, targetSeat }) => {

        const room = rooms[roomId];

        if (
            !room ||
            room.gameState !== 'LOBBY'
        ) {
            return;
        }

        let currentSeat =
            room.seats.findIndex(
                s => s && s.id === socket.id
            );

        if (
            currentSeat !== -1 &&
            room.seats[targetSeat] === null
        ) {

            room.seats[targetSeat] =
                room.seats[currentSeat];

            room.seats[targetSeat].seat =
                targetSeat;

            room.seats[currentSeat] = null;

            io.to(roomId).emit(
                'updateRoom',
                room
            );
        }
    });

    // ---------------------------------------------------------
    // เติม AI
    // ---------------------------------------------------------
    socket.on('fillAI', ({ roomId }) => {

        const room = rooms[roomId];

        if (
            !room ||
            room.gameState !== 'LOBBY'
        ) {
            return;
        }

        if (room.mode === '1V1') {
            // ถ้ามีเจ้าของห้องแล้ว ให้เติม AI ฝั่งตรงข้ามเป็น Seat 1 + 3
            if (room.seats[0] && !room.seats[0].isAI) {
                fill1v1AIPair(room);
            }
        } else {
            for (let i = 0; i < 4; i++) {
                if (room.seats[i] === null) {
                    room.seats[i] = {
                        id: `bot-${i}`,
                        name: `บอท AI ${i}`,
                        isAI: true,
                        seat: i
                    };
                }
            }
        }

        io.to(roomId).emit(
            'updateRoom',
            room
        );
    });

    // ---------------------------------------------------------
    // เริ่มเกม
    // ---------------------------------------------------------
    socket.on('startGameReq', ({ roomId }) => {

        const room = rooms[roomId];

        if (!room) return;

        if (
            room.seats.some(
                s => s === null
            )
        ) {
            return socket.emit(
                'errorMessage',
                'ที่นั่งยังไม่ครบ 4 คน'
            );
        }

        startNewGame(room);
    });

    // ---------------------------------------------------------
    // ประมูล
    // ---------------------------------------------------------
    socket.on(
        'submitBid',
        ({ roomId, bidValue, isPass }) => {

            const room = rooms[roomId];

            if (
                !room ||
                room.gameState !== 'BIDDING'
            ) {
                return;
            }

            if (!socketControlsSeat(room, socket.id, room.bidTurn)) {
                return;
            }

            if (isPass) {

                room.consecutivePasses++;

            } else {

                if (
                    bidValue > room.highestBid
                ) {

                    room.highestBid =
                        bidValue;

                    room.highestBidder =
                        room.bidTurn;

                    room.consecutivePasses = 0;
                }
            }

            // ถ้ามีคนชนะการประมูล
            if (
                room.consecutivePasses >= 3 &&
                room.highestBidder !== -1
            ) {

                room.dealer =
                    room.highestBidder;

                room.gameState =
                    'SELECT_TRUMP';

                broadcastGameState(room);

                checkAITurn(room);

                return;
            }

            room.bidTurn =
                (room.bidTurn + 1) % 4;

            broadcastGameState(room);

            checkAITurn(room);
        }
    );

    // ---------------------------------------------------------
    // เลือกดอกหลัก
    // ---------------------------------------------------------
    socket.on(
        'selectTrump',
        ({ roomId, suit }) => {

            const room = rooms[roomId];

            if (
                !room ||
                room.gameState !== 'SELECT_TRUMP'
            ) {
                return;
            }

            if (!socketControlsSeat(room, socket.id, room.dealer)) {
                return;
            }

            room.trumpSuit = suit;

            room.hands[room.dealer].push(
                ...room.kitty
            );

            room.hands[room.dealer].sort(
                sortCards
            );

            room.kitty = [];

            const dealerSocket =
                io.sockets.sockets.get(
                    room.seats[room.dealer].id
                );

            if (dealerSocket) {
                dealerSocket.emit('yourHand', room.hands[room.dealer]);
            }
            sendControlledHands(room, room.seats[room.dealer].id);

            room.gameState =
                'KITTY_DISCARD';

            broadcastGameState(room);

            checkAITurn(room);
        }
    );

    // ---------------------------------------------------------
    // เจ้ามือทิ้งไพ่
    // ---------------------------------------------------------
    socket.on(
        'confirmDiscard',
        ({ roomId, discardIndexes }) => {

            const room = rooms[roomId];

            if (
                !room ||
                room.gameState !== 'KITTY_DISCARD'
            ) {
                return;
            }

            if (!socketControlsSeat(room, socket.id, room.dealer)) {
                return;
            }

            let dealerHand =
                room.hands[room.dealer];

            discardIndexes.sort(
                (a, b) => b - a
            );

            discardIndexes.forEach(idx => {

                room.kitty.push(
                    dealerHand.splice(idx, 1)[0]
                );
            });

            dealerHand.sort(sortCards);

            const dealerSocket =
                io.sockets.sockets.get(
                    room.seats[room.dealer].id
                );

            if (dealerSocket) {
                dealerSocket.emit('yourHand', dealerHand);
            }
            sendControlledHands(room, room.seats[room.dealer].id);

            room.gameState =
                'PLAYING';

            room.starterPlayer =
                room.dealer;
            room.currentPlayer =
                room.dealer;

            broadcastGameState(room);

            checkAITurn(room);
        }
    );

    // ---------------------------------------------------------
    // ผู้เล่นลงไพ่
    // ---------------------------------------------------------
    socket.on(
        'playCard',
        ({ roomId, seatIndex, cardIndex }) => {

            const room = rooms[roomId];

            if (
                !room ||
                room.gameState !== 'PLAYING'
            ) {
                return;
            }

            let currentTurn =
                getCurrentTurn(room);

            if (seatIndex !== undefined && seatIndex !== currentTurn) {
                return;
            }

            if (!socketControlsSeat(room, socket.id, currentTurn)) {
                return;
            }

            executePlayCard(
                room,
                currentTurn,
                cardIndex
            );
        }
    );

    // ---------------------------------------------------------
    // เริ่มเกมใหม่
    // ---------------------------------------------------------
    socket.on(
        'restartGameReq',
        ({ roomId }) => {

            const room = rooms[roomId];

            if (!room) return;

            startNewGame(room);
        }
    );
});

// =============================================================
// เริ่มเกมใหม่
// =============================================================
function startNewGame(room) {

    room.gameState = 'BIDDING';

    room.deck = createDeck();

    room.highestBid = 60;

    room.highestBidder = -1;

    room.consecutivePasses = 0;

    room.trumpSuit = null;

    room.teamAScore = 0;

    room.teamBScore = 0;

    room.teamACapturedCards = [];

    room.teamBCapturedCards = [];

    room.roundCount = 0;

    room.currentPlayer = -1;

    room.currentRoundCards =
        [null, null, null, null];

    room.playedHistory = [];

    room.voidSuits = {
        0: [],
        1: [],
        2: [],
        3: []
    };

    // แจกไพ่ 12 ใบต่อคน
    for (let i = 0; i < 4; i++) {

        room.hands[i] =
            room.deck
                .splice(0, 12)
                .sort(sortCards);
    }

    // ไพ่กองกลาง 4 ใบ
    room.kitty =
        room.deck.splice(0, 4);

    // สุ่มคนเริ่มประมูล
    room.bidTurn =
        Math.floor(Math.random() * 4);

    // ส่งไพ่ให้ผู้ควบคุมแต่ละคน — 1V1 จะได้ทั้ง 2 มือ
    const humanIds = new Set();
    for (let i = 0; i < 4; i++) {
        const player = room.seats[i];
        if (player && !player.isAI) humanIds.add(player.id);
    }
    humanIds.forEach(id => sendControlledHands(room, id));

    broadcastGameState(room);

    checkAITurn(room);
}

// =============================================================
// หาว่าใครเป็นคนกำลังเล่น
// =============================================================
function getCurrentTurn(room) {

    let playedCount =
        room.currentRoundCards.filter(
            c => c !== null
        ).length;

    return (
        room.starterPlayer +
        playedCount
    ) % 4;
}

// =============================================================
// ลงไพ่
// =============================================================
function executePlayCard(
    room,
    seatIndex,
    cardIndex
) {

    let hand =
        room.hands[seatIndex];

    let card =
        hand[cardIndex];

    // ---------------------------------------------------------
    // ตรวจสอบว่าต้องตามดอกหรือไม่
    // ---------------------------------------------------------
    let playedCount =
        room.currentRoundCards.filter(
            c => c !== null
        ).length;

    if (playedCount > 0) {

        let leadCard =
            room.currentRoundCards[
                room.starterPlayer
            ];

        let hasLeadSuit =
            hand.some(
                c => c.suit === leadCard.suit
            );

        // มีดอกตาม แต่พยายามลงดอกอื่น
        // ไม่อนุญาต
        if (
            hasLeadSuit &&
            card.suit !== leadCard.suit
        ) {
            return;
        }

        // ไม่มีดอกตาม = จำว่า player นี้หมดดอกนี้
        if (
            !hasLeadSuit &&
            !room.voidSuits[seatIndex].includes(
                leadCard.suit
            )
        ) {

            room.voidSuits[seatIndex].push(
                leadCard.suit
            );
        }
    }

    // ---------------------------------------------------------
    // เอาไพ่ออกจากมือ
    // ---------------------------------------------------------
    hand.splice(cardIndex, 1);

    room.currentRoundCards[seatIndex] =
        card;

    const player =
        room.seats[seatIndex];

    if (
        player &&
        !player.isAI
    ) {

        io.to(player.id).emit(
            'yourHand',
            hand
        );
        sendControlledHands(room, player.id);
    }

    // ---------------------------------------------------------
    // ครบ 4 ใบแล้ว
    // ---------------------------------------------------------
    if (
        room.currentRoundCards.filter(
            c => c !== null
        ).length === 4
    ) {

        broadcastGameState(room);

        setTimeout(
            () => resolveRound(room),
            1500
        );

    } else {

        broadcastGameState(room);

        checkAITurn(room);
    }
}
// =============================================================
// จบรอบไพ่
// =============================================================
function resolveRound(room) {

    let leadCard =
        room.currentRoundCards[
            room.starterPlayer
        ];

    let winningSeat =
        room.starterPlayer;

    let winningCard =
        leadCard;

    // ---------------------------------------------------------
    // บันทึกไพ่ที่ออกทั้งหมดลงประวัติ
    // ---------------------------------------------------------
    room.currentRoundCards.forEach(c => {

        if (c) {
            room.playedHistory.push(c);
        }
    });

    // ---------------------------------------------------------
    // คำนวณว่าใครชนะรอบนี้
    //
    // หลัก:
    // 1. ต้องเป็นดอกเดียวกับไพ่ที่กำลังชนะ
    // 2. หรือเป็นดอกหลัก (Trump)
    // ---------------------------------------------------------
    for (let i = 0; i < 4; i++) {

        if (i === room.starterPlayer) {
            continue;
        }
