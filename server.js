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

        let emptySeat =
            room.seats.findIndex(
                s => s === null
            );

        if (emptySeat === -1) {
            return socket.emit(
                'errorMessage',
                'ห้องเต็มแล้ว'
            );
        }

        room.seats[emptySeat] = {
            id: socket.id,
            name: playerName,
            isAI: false,
            seat: emptySeat
        };

        socket.join(roomId);

        socket.emit(
            'joinedSuccess',
            {
                roomId,
                seat: emptySeat
            }
        );

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

                io.to(roomId).emit(
                    'updateGameState',
                    room
                );

                checkAITurn(room);

                return;
            }

            room.bidTurn =
                (room.bidTurn + 1) % 4;

            io.to(roomId).emit(
                'updateGameState',
                room
            );

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

                dealerSocket.emit(
                    'yourHand',
                    room.hands[room.dealer]
                );
            }

            room.gameState =
                'KITTY_DISCARD';

            io.to(roomId).emit(
                'updateGameState',
                room
            );

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

                dealerSocket.emit(
                    'yourHand',
                    dealerHand
                );
            }

            room.gameState =
                'PLAYING';

            room.starterPlayer =
                room.dealer;

            io.to(roomId).emit(
                'updateGameState',
                room
            );

            checkAITurn(room);
        }
    );

    // ---------------------------------------------------------
    // ผู้เล่นลงไพ่
    // ---------------------------------------------------------
    socket.on(
        'playCard',
        ({ roomId, cardIndex }) => {

            const room = rooms[roomId];

            if (
                !room ||
                room.gameState !== 'PLAYING'
            ) {
                return;
            }

            let currentTurn =
                getCurrentTurn(room);

            let playerSocket =
                room.seats[currentTurn];

            if (
                playerSocket.id !== socket.id
            ) {
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

    // ส่งไพ่ให้ผู้เล่นจริง
    for (let i = 0; i < 4; i++) {

        const player =
            room.seats[i];

        if (
            player &&
            !player.isAI
        ) {

            io.to(player.id).emit(
                'yourHand',
                room.hands[i]
            );
        }
    }

    io.to(room.id).emit(
        'updateGameState',
        room
    );

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
    }

    // ---------------------------------------------------------
    // ครบ 4 ใบแล้ว
    // ---------------------------------------------------------
    if (
        room.currentRoundCards.filter(
            c => c !== null
        ).length === 4
    ) {

        io.to(room.id).emit(
            'updateGameState',
            room
        );

        setTimeout(
            () => resolveRound(room),
            1500
        );

    } else {

        io.to(room.id).emit(
            'updateGameState',
            room
        );

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

        let card =
            room.currentRoundCards[i];

        if (!card) {
            continue;
        }

        // ไพ่ดอกเดียวกัน
        if (
            card.suit === winningCard.suit
        ) {

            if (
                CARD_RANKS[card.value] >
                CARD_RANKS[winningCard.value]
            ) {

                winningCard = card;

                winningSeat = i;
            }

        }

        // ไพ่ดอกหลักตัด
        else if (
            card.suit === room.trumpSuit &&
            winningCard.suit !== room.trumpSuit
        ) {

            winningCard = card;

            winningSeat = i;
        }
    }

    // ---------------------------------------------------------
    // คำนวณคะแนนในรอบ
    // ---------------------------------------------------------
    let roundPoints = 0;

    let pointCardsInRound = [];

    room.currentRoundCards.forEach(c => {

        let pts =
            calculateCardScore(c);

        roundPoints += pts;

        if (pts > 0) {
            pointCardsInRound.push(c);
        }
    });

    // ---------------------------------------------------------
    // ทีม 0 + 2 = ทีม A
    // ทีม 1 + 3 = ทีม B
    // ---------------------------------------------------------
    if (
        winningSeat === 0 ||
        winningSeat === 2
    ) {

        room.teamAScore +=
            roundPoints;

        room.teamACapturedCards.push(
            ...pointCardsInRound
        );

    } else {

        room.teamBScore +=
            roundPoints;

        room.teamBCapturedCards.push(
            ...pointCardsInRound
        );
    }

    // ---------------------------------------------------------
    // คนชนะรอบนี้เป็นคนเปิดรอบต่อไป
    // ---------------------------------------------------------
    room.starterPlayer =
        winningSeat;

    room.currentRoundCards =
        [null, null, null, null];

    room.roundCount++;

    // ---------------------------------------------------------
    // ครบ 12 รอบ
    // ---------------------------------------------------------
    if (room.roundCount >= 12) {

        let kittyPoints = 0;

        let kittyPointCards = [];

        room.kitty.forEach(c => {

            let pts =
                calculateCardScore(c);

            // ไพ่กองกลางคูณ 2
            kittyPoints +=
                pts * 2;

            if (pts > 0) {
                kittyPointCards.push(c);
            }
        });

        // คนชนะรอบสุดท้ายได้คะแนนกองกลาง
        if (
            winningSeat === 0 ||
            winningSeat === 2
        ) {

            room.teamAScore +=
                kittyPoints;

            room.teamACapturedCards.push(
                ...kittyPointCards
            );

        } else {

            room.teamBScore +=
                kittyPoints;

            room.teamBCapturedCards.push(
                ...kittyPointCards
            );
        }

        room.gameState = 'END';
    }

    io.to(room.id).emit(
        'updateGameState',
        room
    );

    checkAITurn(room);
}


// =============================================================
// =============================================================
// 🧠 ระบบวิเคราะห์ไพ่สำหรับ AI
// =============================================================
// =============================================================
//
// ส่วนนี้เป็น "เครื่องมือ" ที่ AI ส่วน 3/4 จะนำไปใช้
//
// AI จะสามารถรู้:
//
// - ไพ่ใบไหนออกไปแล้ว
// - ไพ่ใบไหนยังเหลือ
// - ใครหมดดอกอะไร
// - ไพ่ใบไหนใหญ่ที่สุดที่ยังเหลือ
// - ใครเป็นเพื่อน
// - ใครเป็นฝ่ายตรงข้าม
// - เจ้ามือคือใคร
// - เพื่อนเป็นเจ้ามือหรือไม่
// - ไพ่บนโต๊ะตอนนี้ใครกำลังชนะ
//
// หมายเหตุ:
// AI จะไม่อ่านไพ่ในมือของผู้เล่นคนอื่น
// จะใช้เฉพาะข้อมูลที่สามารถสังเกตได้จากการเล่น
// =============================================================


// =============================================================
// ตรวจว่าไพ่เป็นไพ่คะแนนหรือไม่
// =============================================================
function isPointCard(card) {

    if (!card) {
        return false;
    }

    return (
        card.value === 'A' ||
        card.value === '10' ||
        card.value === '5'
    );
}


// =============================================================
// คะแนนของไพ่
//
// A  = 10
// 10 = 10
// 5  = 5
// อื่น ๆ = 0
// =============================================================
function getCardPointValue(card) {

    if (!card) {
        return 0;
    }

    if (card.value === 'A') {
        return 10;
    }

    if (card.value === '10') {
        return 10;
    }

    if (card.value === '5') {
        return 5;
    }

    return 0;
}


// =============================================================
// ตรวจว่าไพ่ใบหนึ่งเป็นดอกหลักหรือไม่
// =============================================================
function isTrumpCard(room, card) {

    if (!card || !room.trumpSuit) {
        return false;
    }

    return card.suit === room.trumpSuit;
}


// =============================================================
// ตรวจว่าเป็นไพ่ที่ควรหลีกเลี่ยงการทิ้ง
//
// ตามเทคนิคของผู้ใช้:
// A / 10 / 5 เป็นไพ่คะแนน
// โดยทั่วไปไม่ควรเผาทิ้งโดยไม่จำเป็น
// =============================================================
function isDangerPointCard(card) {

    if (!card) {
        return false;
    }

    return (
        card.value === 'A' ||
        card.value === '10' ||
        card.value === '5'
    );
}


// =============================================================
// นับไพ่ในมือของ AI ตามดอก
// =============================================================
function countSuitCards(hand, suit) {

    if (!hand) {
        return 0;
    }

    return hand.filter(
        c => c.suit === suit
    ).length;
}


// =============================================================
// ตรวจว่า AI มีดอกนี้หรือไม่
// =============================================================
function hasSuit(hand, suit) {

    return hand.some(
        c => c.suit === suit
    );
}


// =============================================================
// ดึงไพ่ตามดอก
// =============================================================
function getCardsOfSuit(hand, suit) {

    return hand
        .map((card, idx) => ({
            card,
            idx
        }))
        .filter(
            item => item.card.suit === suit
        );
}


// =============================================================
// เรียงไพ่จากเล็ก -> ใหญ่
// =============================================================
function sortCardsSmallToLarge(items) {

    return [...items].sort(
        (a, b) =>
            CARD_RANKS[a.card.value] -
            CARD_RANKS[b.card.value]
    );
}


// =============================================================
// เรียงไพ่จากใหญ่ -> เล็ก
// =============================================================
function sortCardsLargeToSmall(items) {

    return [...items].sort(
        (a, b) =>
            CARD_RANKS[b.card.value] -
            CARD_RANKS[a.card.value]
    );
}


// =============================================================
// ตรวจว่าไพ่ใบนี้ยังเป็นไพ่สูงสุดที่ "เป็นไปได้"
// ในดอกเดียวกันหรือไม่
//
// ตัวอย่าง:
//
// A ออกไปแล้ว
// K ยังไม่ออก
//
// K จะกลายเป็นไพ่ใหญ่สุดที่เหลือ
//
// ถ้า A และ K ออกไปแล้ว
// Q จะกลายเป็นไพ่ใหญ่สุด
// =============================================================
function isHighestRemainingInSuit(
    room,
    hand,
    card
) {

    if (!card) {
        return false;
    }

    const ranks = [
        'A',
        'K',
        'Q',
        'J',
        '10',
        '9',
        '8',
        '7',
        '6',
        '5',
        '4',
        '3',
        '2'
    ];

    for (let rank of ranks) {

        if (
            CARD_RANKS[rank] <=
            CARD_RANKS[card.value]
        ) {
            break;
        }

        // ไพ่ใบนี้ออกไปแล้วหรือไม่
        let alreadyPlayed =
            room.playedHistory.some(
                c =>
                    c.suit === card.suit &&
                    c.value === rank
            );

        if (alreadyPlayed) {
            continue;
        }

        // ไพ่ใบนี้อยู่ในมือเรา
        let inOurHand =
            hand.some(
                c =>
                    c.suit === card.suit &&
                    c.value === rank
            );

        if (inOurHand) {
            continue;
        }

        // ถ้ายังไม่มีหลักฐานว่าไพ่ใบใหญ่กว่านี้
        // ออกไปแล้วหรืออยู่ในมือเรา
        //
        // แปลว่าอาจยังอยู่ในมือคนอื่น
        // ดังนั้นยังไม่สามารถถือว่าเราเป็นไพ่ใหญ่สุดได้
        return false;
    }

    return true;
}


// =============================================================
// ไพ่ใหญ่สุดที่ยังเหลือในดอกนั้น
//
// ฟังก์ชันนี้ใช้ข้อมูล:
//
// - ไพ่ที่ออกไปแล้ว
// - ไพ่ในมือ AI
//
// ไม่อ่านไพ่คนอื่น
// =============================================================
function getHighestRemainingRank(
    room,
    hand,
    suit
) {

    const ranks = [
        'A',
        'K',
        'Q',
        'J',
        '10',
        '9',
        '8',
        '7',
        '6',
        '5',
        '4',
        '3',
        '2'
    ];

    for (let rank of ranks) {

        let alreadyPlayed =
            room.playedHistory.some(
                c =>
                    c.suit === suit &&
                    c.value === rank
            );

        if (alreadyPlayed) {
            continue;
        }

        let inOurHand =
            hand.some(
                c =>
                    c.suit === suit &&
                    c.value === rank
            );

        if (inOurHand) {
            return rank;
        }

        // ไพ่ยังไม่ออกและไม่ได้อยู่ในมือเรา
        // แปลว่ายังไม่รู้ว่าอยู่กับใคร
        return rank;
    }

    return null;
}


// =============================================================
// ตรวจว่าใครหมดดอกอะไร
// =============================================================
function playerHasVoidSuit(
    room,
    seat,
    suit
) {

    if (
        !room.voidSuits ||
        !room.voidSuits[seat]
    ) {
        return false;
    }

    return room.voidSuits[seat]
        .includes(suit);
}


// =============================================================
// บันทึก Void Suit
//
// ฟังก์ชันนี้ใช้เป็นตัวช่วย AI
// แม้ executePlayCard() จะบันทึกไว้แล้ว
// =============================================================
function markVoidSuit(
    room,
    seat,
    suit
) {

    if (!room.voidSuits[seat]) {
        room.voidSuits[seat] = [];
    }

    if (
        !room.voidSuits[seat].includes(suit)
    ) {

        room.voidSuits[seat].push(
            suit
        );
    }
}


// =============================================================
// หาว่าใครเป็นเพื่อน
//
// ทีม:
// Seat 0 <-> Seat 2
// Seat 1 <-> Seat 3
// =============================================================
function getPartnerSeat(seatIndex) {

    return (
        seatIndex + 2
    ) % 4;
}


// =============================================================
// ตรวจว่า seat เป็นทีมเดียวกับเราไหม
// =============================================================
function isSameTeam(
    seatA,
    seatB
) {

    return (
        seatA % 2 ===
        seatB % 2
    );
}


// =============================================================
// ตรวจว่าเพื่อนเป็นเจ้ามือหรือไม่
// =============================================================
function isPartnerDealer(
    room,
    seatIndex
) {

    const partner =
        getPartnerSeat(seatIndex);

    return (
        partner === room.dealer
    );
}


// =============================================================
// ตรวจว่าฝ่ายตรงข้ามเป็นเจ้ามือหรือไม่
// =============================================================
function isOpponentDealer(
    room,
    seatIndex
) {

    if (
        room.dealer === -1
    ) {
        return false;
    }

    return !isSameTeam(
        seatIndex,
        room.dealer
    );
}


// =============================================================
// หาไพ่ที่กำลังชนะอยู่บนโต๊ะ
//
// คืนค่า:
//
// {
//   seat: คนที่กำลังชนะ,
//   card: ไพ่ที่กำลังชนะ
// }
// =============================================================
function getCurrentWinningCard(
    room
) {

    const cards =
        room.currentRoundCards;

    const starter =
        room.starterPlayer;

    let winningSeat =
        starter;

    let winningCard =
        cards[starter];

    if (!winningCard) {
        return {
            seat: -1,
            card: null
        };
    }

    for (let i = 0; i < 4; i++) {

        if (i === starter) {
            continue;
        }

        const card =
            cards[i];

        if (!card) {
            continue;
        }

        // ดอกเดียวกัน
        if (
            card.suit ===
            winningCard.suit
        ) {

            if (
                CARD_RANKS[card.value] >
                CARD_RANKS[winningCard.value]
            ) {

                winningCard =
                    card;

                winningSeat =
                    i;
            }

        }

        // ดอกหลัก
        else if (
            card.suit === room.trumpSuit &&
            winningCard.suit !== room.trumpSuit
        ) {

            winningCard =
                card;

            winningSeat =
                i;
        }
    }

    return {
        seat: winningSeat,
        card: winningCard
    };
}


// =============================================================
// ตรวจว่าไพ่ของเราสามารถฆ่าไพ่ที่กำลังชนะได้หรือไม่
// =============================================================
function canBeatCard(
    room,
    card,
    targetCard
) {

    if (!card || !targetCard) {
        return false;
    }

    // ดอกเดียวกัน
    if (
        card.suit ===
        targetCard.suit
    ) {

        return (
            CARD_RANKS[card.value] >
            CARD_RANKS[targetCard.value]
        );
    }

    // ไพ่เราเป็นดอกหลัก
    if (
        card.suit === room.trumpSuit &&
        targetCard.suit !== room.trumpSuit
    ) {
        return true;
    }

    return false;
}


// =============================================================
// หาไพ่ที่เล็กที่สุดที่สามารถฆ่า targetCard ได้
//
// สำคัญมาก:
//
// AI ไม่ควรใช้ A ฆ่า 5 ถ้ามี 6 ที่สามารถฆ่าได้
// เพราะต้องรักษาไพ่ใหญ่ไว้ใช้ในจังหวะสำคัญ
// =============================================================
function getSmallestWinningCard(
    room,
    cards,
    targetCard
) {

    const winners =
        cards.filter(
            item =>
                canBeatCard(
                    room,
                    item.card,
                    targetCard
                )
        );

    if (winners.length === 0) {
        return null;
    }

    winners.sort(
        (a, b) => {

            // ถ้าเป็นดอกหลักเหมือนกัน
            // เลือกใบเล็กกว่า
            if (
                a.card.suit ===
                b.card.suit
            ) {

                return (
                    CARD_RANKS[a.card.value] -
                    CARD_RANKS[b.card.value]
                );
            }

            // ไพ่ดอกหลักสามารถฆ่าดอกอื่นได้
            if (
                a.card.suit === room.trumpSuit
            ) {
                return 1;
            }

            if (
                b.card.suit === room.trumpSuit
            ) {
                return -1;
            }

            return (
                CARD_RANKS[a.card.value] -
                CARD_RANKS[b.card.value]
            );
        }
    );

    return winners[0];
}


// =============================================================
// หาไพ่เล็กที่สุดที่ "ไม่ใช่คะแนน"
// =============================================================
function getSmallestNonPointCard(
    cards
) {

    const nonPoints =
        cards.filter(
            item =>
                !isDangerPointCard(
                    item.card
                )
        );

    if (
        nonPoints.length === 0
    ) {
        return null;
    }

    nonPoints.sort(
        (a, b) =>
            CARD_RANKS[a.card.value] -
            CARD_RANKS[b.card.value]
    );

    return nonPoints[0];
}


// =============================================================
// หาไพ่ใหญ่ที่สุดที่ "ไม่ใช่คะแนน"
// =============================================================
function getLargestNonPointCard(
    cards
) {

    const nonPoints =
        cards.filter(
            item =>
                !isDangerPointCard(
                    item.card
                )
        );

    if (
        nonPoints.length === 0
    ) {
        return null;
    }

    nonPoints.sort(
        (a, b) =>
            CARD_RANKS[b.card.value] -
            CARD_RANKS[a.card.value]
    );

    return nonPoints[0];
}


// =============================================================
// หาไพ่คะแนน
//
// ลำดับความสำคัญ:
//
// A > 10 > 5
// =============================================================
function getBestPointCard(
    cards
) {

    const points =
        cards.filter(
            item =>
                isPointCard(
                    item.card
                )
        );

    if (
        points.length === 0
    ) {
        return null;
    }

    points.sort(
        (a, b) =>
            getCardPointValue(b.card) -
            getCardPointValue(a.card)
    );

    return points[0];
}


// =============================================================
// หาไพ่ 5 ก่อน 10
//
// ใช้ตอนจำเป็นต้องทิ้งไพ่คะแนน
// ตามเทคนิคของผู้ใช้
// =============================================================
function getFiveBeforeTen(
    cards
) {

    const five =
        cards.find(
            item =>
                item.card.value === '5'
        );

    if (five) {
        return five;
    }

    const ten =
        cards.find(
            item =>
                item.card.value === '10'
        );

    if (ten) {
        return ten;
    }

    return null;
}
// =============================================================
// =============================================================
// 🧠 AI CARD DECISION ENGINE
// =============================================================
// =============================================================
//
// แนวคิดหลัก:
//
// P1 = คนเปิดไพ่
// P2 = คนที่สอง
// P3 = คนที่สาม
// P4 = คนที่สี่
//
// AI จะพยายาม:
//
// 1. รักษาไพ่คะแนน
// 2. รักษา A เมื่อยังไม่จำเป็นต้องใช้
// 3. ใช้ไพ่เล็กที่สุดที่ยังทำหน้าที่ได้
// 4. ช่วยเพื่อนเมื่อเพื่อนกำลังชนะ
// 5. ฆ่าฝ่ายตรงข้ามเมื่อจำเป็น
// 6. สังเกตคนที่หมดดอก
// 7. สังเกตไพ่ใหญ่ที่ออกไปแล้ว
// 8. พยายามใช้ 10 / 5 ตอนเพื่อนกำลังชนะ
// 9. หลีกเลี่ยงการส่งแต้มให้ฝ่ายตรงข้าม
// 10. พยายามรักษาดอกหลักไว้ในจังหวะที่ควรเก็บ
//
// =============================================================


// =============================================================
// หาลำดับตำแหน่งการเล่นในรอบปัจจุบัน
//
// return:
//
// 0 = P1
// 1 = P2
// 2 = P3
// 3 = P4
// =============================================================
function getPlayPosition(room, seatIndex) {

    let starter =
        room.starterPlayer;

    let diff =
        (seatIndex - starter + 4) % 4;

    return diff;
}


// =============================================================
// ดึงไพ่ของ AI พร้อม index
// =============================================================
function getIndexedHand(room, seatIndex) {

    let hand =
        room.hands[seatIndex] || [];

    return hand.map(
        (card, idx) => ({
            card,
            idx
        })
    );
}


// =============================================================
// ตรวจว่าไพ่บนโต๊ะเป็นดอกอะไร
// =============================================================
function getLeadSuit(room) {

    let starter =
        room.starterPlayer;

    let leadCard =
        room.currentRoundCards[starter];

    if (!leadCard) {
        return null;
    }

    return leadCard.suit;
}


// =============================================================
// ไพ่ที่ AI สามารถลงได้ตามกติกา
//
// ถ้ามีดอกนำ ต้องตามดอกนำ
// ถ้าไม่มีดอกนำ สามารถลงดอกอะไรก็ได้
// =============================================================
function getLegalCards(
    room,
    seatIndex
) {

    const hand =
        room.hands[seatIndex] || [];

    const indexed =
        getIndexedHand(
            room,
            seatIndex
        );

    const leadSuit =
        getLeadSuit(room);

    if (!leadSuit) {
        return indexed;
    }

    const followSuit =
        indexed.filter(
            item =>
                item.card.suit === leadSuit
        );

    if (followSuit.length > 0) {
        return followSuit;
    }

    // ไม่มีดอกตาม
    return indexed;
}


// =============================================================
// ตรวจว่ามีไพ่ตามดอกนำหรือไม่
// =============================================================
function mustFollowSuit(
    room,
    seatIndex
) {

    const leadSuit =
        getLeadSuit(room);

    if (!leadSuit) {
        return false;
    }

    return (
        room.hands[seatIndex] || []
    ).some(
        c => c.suit === leadSuit
    );
}


// =============================================================
// หาคะแนนที่อยู่บนโต๊ะตอนนี้
// =============================================================
function getCurrentRoundPoints(room) {

    let total = 0;

    room.currentRoundCards.forEach(
        card => {

            if (card) {
                total +=
                    getCardPointValue(card);
            }
        }
    );

    return total;
}


// =============================================================
// ตรวจว่าคนที่กำลังชนะเป็นเพื่อนหรือไม่
// =============================================================
function isPartnerWinning(
    room,
    seatIndex
) {

    const winning =
        getCurrentWinningCard(room);

    if (winning.seat === -1) {
        return false;
    }

    return isSameTeam(
        seatIndex,
        winning.seat
    ) &&
    winning.seat !== seatIndex;
}


// =============================================================
// ตรวจว่าฝ่ายตรงข้ามกำลังชนะ
// =============================================================
function isOpponentWinning(
    room,
    seatIndex
) {

    const winning =
        getCurrentWinningCard(room);

    if (winning.seat === -1) {
        return false;
    }

    return !isSameTeam(
        seatIndex,
        winning.seat
    );
}


// =============================================================
// ตรวจว่าไพ่บนโต๊ะของเพื่อนเป็นไพ่ใหญ่ที่สุด
// ที่เรารู้ว่าเหลืออยู่หรือไม่
//
// ใช้เป็น "ตัวบอกแนวโน้ม"
// ไม่ได้แอบรู้ไพ่ในมือคนอื่น
// =============================================================
function partnerCardLooksStrong(
    room,
    partnerSeat
) {

    const card =
        room.currentRoundCards[
            partnerSeat
        ];

    if (!card) {
        return false;
    }

    return isHighestRemainingInSuit(
        room,
        room.hands[partnerSeat] || [],
        card
    );
}


// =============================================================
// ตรวจว่าไพ่ของเพื่อนเป็นไพ่ใหญ่ที่สุด
// เมื่อเทียบกับไพ่ที่ออกบนโต๊ะตอนนี้
// =============================================================
function partnerIsCurrentlyWinning(
    room,
    seatIndex
) {

    const partner =
        getPartnerSeat(seatIndex);

    const winning =
        getCurrentWinningCard(room);

    return (
        winning.seat === partner
    );
}


// =============================================================
// เลือกไพ่คะแนนเพื่อส่งให้เพื่อน
//
// หลัก:
// 10 / 5
//
// โดยทั่วไปถ้ามี 5 จะใช้ 5 ก่อน
// เพื่อรักษา 10 / A ไว้
// =============================================================
function choosePointToPartner(
    room,
    legalCards
) {

    if (!legalCards.length) {
        return null;
    }

    const nonTrumpPoints =
        legalCards.filter(
            item =>
                isPointCard(item.card) &&
                item.card.suit !== room.trumpSuit
        );

    const trumpPoints =
        legalCards.filter(
            item =>
                isPointCard(item.card) &&
                item.card.suit === room.trumpSuit
        );

    // ---------------------------------------------------------
    // ถ้ามี 5 ให้ส่ง 5 ก่อน
    // ---------------------------------------------------------
    const five =
        nonTrumpPoints.find(
            item =>
                item.card.value === '5'
        );

    if (five) {
        return five;
    }

    // ---------------------------------------------------------
    // ถ้าไม่มี 5 ให้ส่ง 10
    // ---------------------------------------------------------
    const ten =
        nonTrumpPoints.find(
            item =>
                item.card.value === '10'
        );

    if (ten) {
        return ten;
    }

    // ---------------------------------------------------------
    // A ไม่ควรส่งให้เพื่อนง่าย ๆ
    // แต่ถ้าเป็นไพ่คะแนนที่เหลือและจำเป็น
    // จึงค่อยใช้
    // ---------------------------------------------------------
    const ace =
        nonTrumpPoints.find(
            item =>
                item.card.value === 'A'
        );

    if (ace) {
        return ace;
    }

    // ---------------------------------------------------------
    // ถ้าไม่มีแต้ม non-trump
    // ค่อยพิจารณา trump
    // ---------------------------------------------------------
    const trumpFive =
        trumpPoints.find(
            item =>
                item.card.value === '5'
        );

    if (trumpFive) {
        return trumpFive;
    }

    const trumpTen =
        trumpPoints.find(
            item =>
                item.card.value === '10'
        );

    if (trumpTen) {
        return trumpTen;
    }

    const trumpAce =
        trumpPoints.find(
            item =>
                item.card.value === 'A'
        );

    if (trumpAce) {
        return trumpAce;
    }

    return null;
}


// =============================================================
// P1
//
// คนเปิดไพ่
// =============================================================
function chooseP1Card(
    room,
    seatIndex,
    legalCards
) {

    const hand =
        room.hands[seatIndex] || [];

    const partnerDealer =
        isPartnerDealer(
            room,
            seatIndex
        );

    const opponentDealer =
        isOpponentDealer(
            room,
            seatIndex
        );

    // ---------------------------------------------------------
    // ถ้ามี A
    //
    // ตามหลักที่ผู้ใช้ให้มา:
    //
    // - ถ้าเป็นสถานการณ์ที่เหมาะสม ให้ใช้ A
    // - แต่ถ้าเป็นเพื่อนเป็นเจ้ามือและ A ยังมีประโยชน์
    //   อาจเก็บไว้เพื่อรอจังหวะ
    // ---------------------------------------------------------
    const aces =
        legalCards.filter(
            item =>
                item.card.value === 'A'
        );

    // ---------------------------------------------------------
    // ดอกหลัก
    // ---------------------------------------------------------
    const trumpCards =
        legalCards.filter(
            item =>
                item.card.suit === room.trumpSuit
        );

    // ---------------------------------------------------------
    // ถ้าเพื่อนเป็นเจ้ามือ
    //
    // พยายามสร้างจังหวะให้ทีมตัวเอง
    // และไม่รีบเผา A ถ้ายังมีทางเลือกอื่น
    // ---------------------------------------------------------
    if (partnerDealer) {

        // ถ้ามี A ที่เป็นดอกที่คนอื่นน่าจะตามได้
        // และไม่ได้จำเป็นต้องใช้ทันที
        // ให้พยายามเก็บไว้
        const safeNonPoint =
            legalCards.filter(
                item =>
                    !isDangerPointCard(item.card) &&
                    item.card.suit !== room.trumpSuit
            );

        if (safeNonPoint.length > 0) {

            // -------------------------------------------------
            // ตัวเลือก 1:
            // ไพ่เล็ก ๆ ของดอกหลัก
            // แต่ไม่ใช่ 10 / 5
            // -------------------------------------------------
            const smallTrump =
                trumpCards
                    .filter(
                        item =>
                            !isDangerPointCard(item.card)
                    )
                    .sort(
                        (a, b) =>
                            CARD_RANKS[a.card.value] -
                            CARD_RANKS[b.card.value]
                    );

            if (smallTrump.length > 0) {
                return smallTrump[0];
            }

            // -------------------------------------------------
            // ตัวเลือก 2:
            // ไพ่ใหญ่สุดที่ไม่ใช่ดอกหลัก
            // แต่ไม่ใช่ 10 / 5
            // -------------------------------------------------
            const largeNonTrump =
                safeNonPoint
                    .filter(
                        item =>
                            item.card.suit !== room.trumpSuit
                    )
                    .sort(
                        (a, b) =>
                            CARD_RANKS[b.card.value] -
                            CARD_RANKS[a.card.value]
                    );

            if (largeNonTrump.length > 0) {
                return largeNonTrump[0];
            }

            return safeNonPoint[0];
        }

        // -----------------------------------------------------
        // ถ้าไม่เหลือไพ่ปลอดภัย
        //
        // ใช้ 5 ก่อน 10
        // -----------------------------------------------------
        const five =
            legalCards.find(
                item =>
                    item.card.value === '5'
            );

        if (five) {
            return five;
        }

        const ten =
            legalCards.find(
                item =>
                    item.card.value === '10'
            );

        if (ten) {
            return ten;
        }

        // A เป็นตัวเลือกสุดท้าย
        if (aces.length > 0) {
            return aces[0];
        }
    }

    // ---------------------------------------------------------
    // ถ้าฝ่ายตรงข้ามเป็นเจ้ามือ
    //
    // เปิดไพ่ใหญ่เพื่อกดดันเจ้ามือ
    // แต่ไม่รีบเผา 10 / 5
    // ---------------------------------------------------------
    if (opponentDealer) {

        // A ยังเป็นไพ่เปิดที่แข็งแรง
        if (aces.length > 0) {
            return aces[0];
        }

        // ไพ่ใหญ่ที่ไม่ใช่ 10 / 5
        const largeSafe =
            legalCards
                .filter(
                    item =>
                        !isDangerPointCard(
                            item.card
                        ) &&
                        item.card.suit !== room.trumpSuit
                )
                .sort(
                    (a, b) =>
                        CARD_RANKS[b.card.value] -
                        CARD_RANKS[a.card.value]
                );

        if (largeSafe.length > 0) {

            // ถ้าดอกนี้เจ้ามือไม่มี
            // ยิ่งเหมาะกับการเปิด
            const opponentVoid =
                playerHasVoidSuit(
                    room,
                    room.dealer,
                    largeSafe[0].card.suit
                );

            if (opponentVoid) {
                return largeSafe[0];
            }

            return largeSafe[0];
        }

        // ไพ่หลักที่ใหญ่
        const trumpLarge =
            trumpCards
                .sort(
                    (a, b) =>
                        CARD_RANKS[b.card.value] -
                        CARD_RANKS[a.card.value]
                );

        if (trumpLarge.length > 0) {
            return trumpLarge[0];
        }

        // 5 ก่อน 10
        const five =
            legalCards.find(
                item =>
                    item.card.value === '5'
            );

        if (five) {
            return five;
        }

        const ten =
            legalCards.find(
                item =>
                    item.card.value === '10'
            );

        if (ten) {
            return ten;
        }

        return legalCards[0];
    }

    // ---------------------------------------------------------
    // กรณีทั่วไป
    //
    // 1. A
    // 2. ไพ่เล็กของดอกหลัก
    // 3. ไพ่ใหญ่ที่ไม่ใช่ดอกหลัก
    // 4. 5
    // 5. 10
    // ---------------------------------------------------------

    if (aces.length > 0) {
        return aces[0];
    }

    // ---------------------------------------------------------
    // ตัวเลือก 1:
    // ไพ่เล็กของดอกหลัก
    // ไม่ใช่ 10 / 5
    // ---------------------------------------------------------
    const smallTrump =
        trumpCards
            .filter(
                item =>
                    !isDangerPointCard(item.card)
            )
            .sort(
                (a, b) =>
                    CARD_RANKS[a.card.value] -
                    CARD_RANKS[b.card.value]
            );

    if (smallTrump.length > 0) {
        return smallTrump[0];
    }

    // ---------------------------------------------------------
    // ตัวเลือก 2:
    // ไพ่ใหญ่ที่สุดที่ไม่ใช่ดอกหลัก
    // ไม่ใช่ 10 / 5
    // ---------------------------------------------------------
    const largeNonTrump =
        legalCards
            .filter(
                item =>
                    !isDangerPointCard(item.card) &&
                    item.card.suit !== room.trumpSuit
            )
            .sort(
                (a, b) =>
                    CARD_RANKS[b.card.value] -
                    CARD_RANKS[a.card.value]
            );

    if (largeNonTrump.length > 0) {
        return largeNonTrump[0];
    }

    // ---------------------------------------------------------
    // ไม่มีไพ่ปลอดภัย
    // 5 ก่อน 10
    // ---------------------------------------------------------
    const five =
        legalCards.find(
            item =>
                item.card.value === '5'
        );

    if (five) {
        return five;
    }

    const ten =
        legalCards.find(
            item =>
                item.card.value === '10'
        );

    if (ten) {
        return ten;
    }

    return legalCards[0];
}


// =============================================================
// P2
//
// คนที่ 2
//
// หลัก:
//
// 1. ถ้าชนะได้ -> พยายามชนะ
// 2. ใช้ไพ่เล็กที่สุดที่ชนะ
// 3. หลีกเลี่ยง 10 / 5
// 4. ถ้าชนะไม่ได้ -> ลงไพ่เล็กที่สุด
// 5. ถ้าไพ่เล็กสุดเป็น 10 / 5 และมีใบอื่น
//    ให้เลือกใบอื่นก่อน
// =============================================================
function chooseP2Card(
    room,
    seatIndex,
    legalCards
) {

    if (!legalCards.length) {
        return null;
    }

    const winning =
        getCurrentWinningCard(room);

    const targetCard =
        winning.card;

    const partner =
        getPartnerSeat(seatIndex);

    // ---------------------------------------------------------
    // ถ้าเพื่อนกำลังชนะอยู่
    //
    // อย่ารีบฆ่าเพื่อน
    // ให้พยายามรักษาไพ่คะแนนไว้
    // ---------------------------------------------------------
    if (
        winning.seat === partner
    ) {

        // ถ้าเพื่อนเป็นคนชนะอยู่
        // ให้ทิ้งไพ่เล็กที่ไม่ใช่คะแนน
        const smallNonPoint =
            getSmallestNonPointCard(
                legalCards
            );

        if (smallNonPoint) {
            return smallNonPoint;
        }

        // ถ้าไม่มีไพ่ non-point
        // ใช้ 5 ก่อน 10
        const five =
            legalCards.find(
                item =>
                    item.card.value === '5'
            );

        if (five) {
            return five;
        }

        const ten =
            legalCards.find(
                item =>
                    item.card.value === '10'
            );

        if (ten) {
            return ten;
        }

        // A เป็นตัวเลือกสุดท้าย
        return legalCards
            .sort(
                (a, b) =>
                    CARD_RANKS[a.card.value] -
                    CARD_RANKS[b.card.value]
            )[0];
    }

    // ---------------------------------------------------------
    // ถ้าฝ่ายตรงข้ามกำลังชนะ
    //
    // พยายามฆ่า
    // ---------------------------------------------------------
    const smallestWinner =
        getSmallestWinningCard(
            room,
            legalCards,
            targetCard
        );

    if (smallestWinner) {

        // -----------------------------------------------------
        // ถ้าไพ่ที่ฆ่าได้เป็น 10 / 5
        // และมีไพ่ใบอื่นที่ฆ่าได้
        // ให้เลือกใบอื่น
        // -----------------------------------------------------
        if (
            isDangerPointCard(
                smallestWinner.card
            )
        ) {

            const alternative =
                legalCards
                    .filter(
                        item =>
                            !isDangerPointCard(
                                item.card
                            ) &&
                            canBeatCard(
                                room,
                                item.card,
                                targetCard
                            )
                    )
                    .sort(
                        (a, b) =>
                            CARD_RANKS[a.card.value] -
                            CARD_RANKS[b.card.value]
                    );

            if (alternative.length > 0) {
                return alternative[0];
            }
        }

        return smallestWinner;
    }

    // ---------------------------------------------------------
    // ฆ่าไม่ได้
    //
    // ลงไพ่เล็กที่สุด
    // แต่ไม่รีบเผา 5 / 10
    // ---------------------------------------------------------
    const smallNonPoint =
        getSmallestNonPointCard(
            legalCards
        );

    if (smallNonPoint) {
        return smallNonPoint;
    }

    // 5 ก่อน 10
    const five =
        legalCards.find(
            item =>
                item.card.value === '5'
        );

    if (five) {
        return five;
    }

    const ten =
        legalCards.find(
            item =>
                item.card.value === '10'
        );

    if (ten) {
        return ten;
    }

    return legalCards
        .sort(
            (a, b) =>
                CARD_RANKS[a.card.value] -
                CARD_RANKS[b.card.value]
        )[0];
}


// =============================================================
// P3
//
// คนที่ 3
//
// จุดสำคัญตามเทคนิค:
//
// ถ้าคนแรกยังเป็นผู้ชนะ
// และไพ่คนแรกเป็นไพ่ใหญ่ที่สุด
// -> พยายามส่ง 10 / 5 ให้เพื่อน
//
// ถ้าคนแรกไม่ใช่ไพ่ใหญ่ที่สุด
// -> พยายามใช้ไพ่ใหญ่เพื่อเปลี่ยนผู้ชนะ
//
// ถ้าชนะไม่ได้
// -> ลงไพ่เล็กที่สุด
// -> หลีกเลี่ยง 10 / 5
//
// กรณี A♥ -> 10♠
//
// ถ้าเราไม่มี ♥
// และมี ♠
// -> สามารถใช้ ♠ ฆ่า 10♠ ได้
//
// แต่ถ้าไม่มี ♠ ที่ฆ่าได้
// -> เก็บดอกหลักไว้
// -> ทิ้งไพ่เล็กดอกอื่น
// =============================================================
function chooseP3Card(
    room,
    seatIndex,
    legalCards
) {

    if (!legalCards.length) {
        return null;
    }

    const winning =
        getCurrentWinningCard(room);

    const partner =
        getPartnerSeat(seatIndex);

    const partnerWinning =
        winning.seat === partner;

    const opponentWinning =
        !partnerWinning &&
        winning.seat !== seatIndex;

    // ---------------------------------------------------------
    // ถ้าเพื่อนกำลังชนะ
    // ---------------------------------------------------------
    if (partnerWinning) {

        // -----------------------------------------------------
        // ถ้าไพ่เพื่อนดูเป็นไพ่ใหญ่ที่สุด
        // ส่งคะแนนให้เพื่อน
        // -----------------------------------------------------
        const partnerCard =
            room.currentRoundCards[
                partner
            ];

        if (
            partnerCard &&
            isHighestRemainingInSuit(
                room,
                room.hands[partner] || [],
                partnerCard
            )
        ) {

            const point =
                choosePointToPartner(
                    room,
                    legalCards
                );

            if (point) {
                return point;
            }
        }

        // -----------------------------------------------------
        // ถ้าไม่ต้องส่งคะแนน
        // ลงไพ่เล็กที่ไม่ใช่คะแนน
        // -----------------------------------------------------
        const smallNonPoint =
            getSmallestNonPointCard(
                legalCards
            );

        if (smallNonPoint) {
            return smallNonPoint;
        }

        const five =
            legalCards.find(
                item =>
                    item.card.value === '5'
            );

        if (five) {
            return five;
        }

        const ten =
            legalCards.find(
                item =>
                    item.card.value === '10'
            );

        if (ten) {
            return ten;
        }

        return legalCards
            .sort(
                (a, b) =>
                    CARD_RANKS[a.card.value] -
                    CARD_RANKS[b.card.value]
            )[0];
    }

    // ---------------------------------------------------------
    // ฝ่ายตรงข้ามกำลังชนะ
    // ---------------------------------------------------------
    if (opponentWinning) {

        // -----------------------------------------------------
        // ก่อนอื่นลองฆ่าด้วยดอกเดียวกัน
        // -----------------------------------------------------
        const sameSuitWinners =
            legalCards.filter(
                item =>
                    item.card.suit ===
                    winning.card.suit &&
                    CARD_RANKS[item.card.value] >
                    CARD_RANKS[winning.card.value]
            );

        if (
            sameSuitWinners.length > 0
        ) {

            // เลือกไพ่เล็กที่สุดที่ฆ่าได้
            sameSuitWinners.sort(
                (a, b) =>
                    CARD_RANKS[a.card.value] -
                    CARD_RANKS[b.card.value]
            );

            const best =
                sameSuitWinners[0];

            // ถ้าเป็น 5 / 10
            // และมีทางเลือกอื่น
            // ให้พยายามใช้ใบอื่น
            if (
                isDangerPointCard(best.card)
            ) {

                const safe =
                    sameSuitWinners.find(
                        item =>
                            !isDangerPointCard(
                                item.card
                            )
                    );

                if (safe) {
                    return safe;
                }
            }

            return best;
        }

        // -----------------------------------------------------
        // ถ้าไม่มีไพ่ตามดอก
        //
        // พิจารณาตัดด้วยดอกหลัก
        // -----------------------------------------------------
        const leadSuit =
            winning.card.suit;

        const noLead =
            !hasSuit(
                room.hands[seatIndex],
                leadSuit
            );

        if (noLead) {

            const trumpWinners =
                legalCards.filter(
                    item =>
                        item.card.suit ===
                        room.trumpSuit &&
                        canBeatCard(
                            room,
                            item.card,
                            winning.card
                        )
                );

            if (
                trumpWinners.length > 0
            ) {

                trumpWinners.sort(
                    (a, b) =>
                        CARD_RANKS[a.card.value] -
                        CARD_RANKS[b.card.value]
                );

                // -------------------------------------------------
                // ถ้าเป็นสถานการณ์ A♥ -> 10♠
                //
                // ถ้าเราไม่มี ♥
                // และมี ♠
                // เราสามารถตัด 10♠ ได้
                //
                // แต่ถ้าต้องใช้ A♠ เพื่อฆ่า
                // ให้คิดก่อนว่า 10 คะแนนคุ้มกับการเผา A หรือไม่
                // -------------------------------------------------
                const safeTrump =
                    trumpWinners.find(
                        item =>
                            !isDangerPointCard(
                                item.card
                            )
                    );

                if (safeTrump) {
                    return safeTrump;
                }

                // ถ้าต้องใช้คะแนน
                // ให้พิจารณา 5 ก่อน 10 ก่อน A
                const five =
                    trumpWinners.find(
                        item =>
                            item.card.value === '5'
                    );

                if (five) {
                    return five;
                }

                const ten =
                    trumpWinners.find(
                        item =>
                            item.card.value === '10'
                    );

                if (ten) {
                    return ten;
                }

                const ace =
                    trumpWinners.find(
                        item =>
                            item.card.value === 'A'
                    );

                if (ace) {
                    return ace;
                }
            }

            // -------------------------------------------------
            // ฆ่าไม่ได้
            //
            // เก็บดอกหลัก
            // แล้วทิ้งไพ่เล็กดอกอื่น
            // -------------------------------------------------
            const nonTrump =
                legalCards.filter(
                    item =>
                        item.card.suit !==
                        room.trumpSuit
                );

            const smallNonTrump =
                getSmallestNonPointCard(
                    nonTrump
                );

            if (smallNonTrump) {
                return smallNonTrump;
            }
        }

        // -----------------------------------------------------
        // ถ้ายังมีไพ่ตามดอก
        // แต่ฆ่าไม่ได้
        //
        // ห้ามส่ง 10 / 5 ให้ฝ่ายตรงข้ามถ้าไม่จำเป็น
        // -----------------------------------------------------
        const smallNonPoint =
            getSmallestNonPointCard(
                legalCards
            );

        if (smallNonPoint) {
            return smallNonPoint;
        }

        const five =
            legalCards.find(
                item =>
                    item.card.value === '5'
            );

        if (five) {
            return five;
        }

        const ten =
            legalCards.find(
                item =>
                    item.card.value === '10'
            );

        if (ten) {
            return ten;
        }

        return legalCards
            .sort(
                (a, b) =>
                    CARD_RANKS[a.card.value] -
                    CARD_RANKS[b.card.value]
            )[0];
    }

    // ---------------------------------------------------------
    // กรณีทั่วไป
    // ---------------------------------------------------------
    return chooseP2Card(
        room,
        seatIndex,
        legalCards
    );
}


// =============================================================
// P4
//
// คนที่ 4
//
// สำคัญมาก:
//
// คนที่ 2 คือเพื่อนของ P4
//
// ถ้าไพ่คนสองกำลังชนะ
// -> ส่ง 10 / 5 ให้เพื่อน
//
// ถ้าคนสองไม่ชนะ
// -> พยายามฆ่าด้วยไพ่ใหญ่สุดที่จำเป็น
//
// ถ้าฆ่าไม่ได้
// -> ทิ้งไพ่เล็ก
// =============================================================
function chooseP4Card(
    room,
    seatIndex,
    legalCards
) {

    if (!legalCards.length) {
        return null;
    }

    const winning =
        getCurrentWinningCard(room);

    const partner =
        getPartnerSeat(seatIndex);

    // ---------------------------------------------------------
    // ตรวจว่าคนสองเป็นเพื่อนหรือไม่
    // ---------------------------------------------------------
    const partnerWinning =
        winning.seat === partner;

    // ---------------------------------------------------------
    // ถ้าเพื่อนกำลังชนะ
    // ---------------------------------------------------------
    if (partnerWinning) {

        const partnerCard =
            room.currentRoundCards[
                partner
            ];

        // -----------------------------------------------------
        // ถ้าเพื่อนมีไพ่ใหญ่สุด
        // พยายามส่งแต้ม
        // -----------------------------------------------------
        if (
            partnerCard &&
            (
                isHighestRemainingInSuit(
                    room,
                    room.hands[partner] || [],
                    partnerCard
                ) ||
                partnerCard.value === 'A'
            )
        ) {

            const point =
                choosePointToPartner(
                    room,
                    legalCards
                );

            if (point) {
                return point;
            }
        }

        // -----------------------------------------------------
        // ถ้าไม่ควรส่งแต้ม
        // ทิ้งใบเล็กที่ไม่ใช่แต้ม
        // -----------------------------------------------------
        const smallNonPoint =
            getSmallestNonPointCard(
                legalCards
            );

        if (smallNonPoint) {
            return smallNonPoint;
        }

        // 5 ก่อน 10
        const five =
            legalCards.find(
                item =>
                    item.card.value === '5'
            );

        if (five) {
            return five;
        }

        const ten =
            legalCards.find(
                item =>
                    item.card.value === '10'
            );

        if (ten) {
            return ten;
        }

        return legalCards
            .sort(
                (a, b) =>
                    CARD_RANKS[a.card.value] -
                    CARD_RANKS[b.card.value]
            )[0];
    }

    // ---------------------------------------------------------
    // เพื่อนไม่ได้ชนะ
    //
    // พยายามฆ่าคนที่กำลังชนะ
    // ---------------------------------------------------------
    const winner =
        getSmallestWinningCard(
            room,
            legalCards,
            winning.card
        );

    if (winner) {

        // -----------------------------------------------------
        // ถ้าชนะด้วยไพ่ที่ไม่ใช่คะแนน
        // เลือกใบนี้ก่อน
        // -----------------------------------------------------
        if (
            !isDangerPointCard(
                winner.card
            )
        ) {
            return winner;
        }

        // -----------------------------------------------------
        // ถ้ามีไพ่ใบอื่นที่ชนะและไม่ใช่คะแนน
        // -----------------------------------------------------
        const safeWinner =
            legalCards
                .filter(
                    item =>
                        !isDangerPointCard(
                            item.card
                        ) &&
                        canBeatCard(
                            room,
                            item.card,
                            winning.card
                        )
                )
                .sort(
                    (a, b) =>
                        CARD_RANKS[a.card.value] -
                        CARD_RANKS[b.card.value]
                );

        if (
            safeWinner.length > 0
        ) {
            return safeWinner[0];
        }

        // -----------------------------------------------------
        // ถ้าต้องใช้คะแนน
        // 5 -> 10 -> A
        // -----------------------------------------------------
        const five =
            legalCards.find(
                item =>
                    item.card.value === '5' &&
                    canBeatCard(
                        room,
                        item.card,
                        winning.card
                    )
            );

        if (five) {
            return five;
        }

        const ten =
            legalCards.find(
                item =>
                    item.card.value === '10' &&
                    canBeatCard(
                        room,
                        item.card,
                        winning.card
                    )
            );

        if (ten) {
            return ten;
        }

        const ace =
            legalCards.find(
                item =>
                    item.card.value === 'A' &&
                    canBeatCard(
                        room,
                        item.card,
                        winning.card
                    )
            );

        if (ace) {
            return ace;
        }

        return winner;
    }

    // ---------------------------------------------------------
    // ฆ่าไม่ได้
    // ---------------------------------------------------------
    const smallNonPoint =
        getSmallestNonPointCard(
            legalCards
        );

    if (smallNonPoint) {
        return smallNonPoint;
    }

    // 5 ก่อน 10
    const five =
        legalCards.find(
            item =>
                item.card.value === '5'
        );

    if (five) {
        return five;
    }

    const ten =
        legalCards.find(
            item =>
                item.card.value === '10'
        );

    if (ten) {
        return ten;
    }

    return legalCards
        .sort(
            (a, b) =>
                CARD_RANKS[a.card.value] -
                CARD_RANKS[b.card.value]
        )[0];
}


// =============================================================
// ฟังก์ชันหลักของ AI
//
// ฟังก์ชันนี้จะถูกเรียกโดย checkAITurn()
// =============================================================
function getSmartAICardIndex(
    room,
    seatIndex
) {

    const legalCards =
        getLegalCards(
            room,
            seatIndex
        );

    if (
        !legalCards ||
        legalCards.length === 0
    ) {
        return 0;
    }

    const position =
        getPlayPosition(
            room,
            seatIndex
        );

    let selected = null;

    // ---------------------------------------------------------
    // P1
    // ---------------------------------------------------------
    if (position === 0) {

        selected =
            chooseP1Card(
                room,
                seatIndex,
                legalCards
            );
    }

    // ---------------------------------------------------------
    // P2
    // ---------------------------------------------------------
    else if (position === 1) {

        selected =
            chooseP2Card(
                room,
                seatIndex,
                legalCards
            );
    }

    // ---------------------------------------------------------
    // P3
    // ---------------------------------------------------------
    else if (position === 2) {

        selected =
            chooseP3Card(
                room,
                seatIndex,
                legalCards
            );
    }

    // ---------------------------------------------------------
    // P4
    // ---------------------------------------------------------
    else {

        selected =
            chooseP4Card(
                room,
                seatIndex,
                legalCards
            );
    }

    // ---------------------------------------------------------
    // Safety fallback
    // ---------------------------------------------------------
    if (!selected) {

        selected =
            getSmallestNonPointCard(
                legalCards
            );
    }

    if (!selected) {

        selected =
            legalCards[0];
    }

    return selected.idx;
}


// =============================================================
// 🧠 AI จำเหตุการณ์จากไพ่ที่ออก
//
// ใช้หลังจากแต่ละรอบ
// =============================================================
function updateAIKnowledge(room) {

    if (
        !room.playedHistory ||
        room.playedHistory.length === 0
    ) {
        return;
    }

    // ---------------------------------------------------------
    // สร้างข้อมูลว่าไพ่แต่ละใบออกแล้วหรือยัง
    // ---------------------------------------------------------
    room.cardKnowledge = {};

    room.playedHistory.forEach(card => {

        if (!card) return;

        const key =
            `${card.suit}_${card.value}`;

        room.cardKnowledge[key] = true;
    });

    // ---------------------------------------------------------
    // ตรวจสอบ voidSuits อีกครั้ง
    // ---------------------------------------------------------
    for (let seat = 0; seat < 4; seat++) {

        if (
            !room.voidSuits[seat]
        ) {
            room.voidSuits[seat] = [];
        }
    }
}


// =============================================================
// หาว่าดอกไหนมีแนวโน้มปลอดภัยสำหรับเปิด
//
// ใช้ตอน P1
// =============================================================
function getSafeLeadSuits(
    room,
    seatIndex
) {

    const hand =
        room.hands[seatIndex] || [];

    const suits = [
        '♠',
        '♥️',
        '♣',
        '♦️'
    ];

    let result = [];

    suits.forEach(suit => {

        const cards =
            hand.filter(
                c => c.suit === suit
            );

        if (
            cards.length === 0
        ) {
            return;
        }

        let score = 0;

        // มี A
        if (
            cards.some(
                c => c.value === 'A'
            )
        ) {
            score += 50;
        }

        // มี K
        if (
            cards.some(
                c => c.value === 'K'
            )
        ) {
            score += 20;
        }

        // จำนวนไพ่
        score +=
            cards.length * 3;

        // ถ้าเจ้ามือหมดดอกนี้
        // เปิดดอกนี้มีโอกาสกดเจ้ามือ
        if (
            room.dealer !== -1 &&
            playerHasVoidSuit(
                room,
                room.dealer,
                suit
            )
        ) {
            score += 30;
        }

        // ดอกหลักมีค่าเพิ่ม
        if (
            suit === room.trumpSuit
        ) {
            score += 5;
        }

        result.push({
            suit,
            score,
            cards
        });
    });

    return result.sort(
        (a, b) =>
            b.score - a.score
    );
}


// =============================================================
// วิเคราะห์มือ AI
//
// ใช้สำหรับการตัดสินใจเชิงกลยุทธ์
// =============================================================
function evaluateAIHand(
    room,
    seatIndex
) {

    const hand =
        room.hands[seatIndex] || [];

    const suits = [
        '♠',
        '♥️',
        '♣',
        '♦️'
    ];

    let result = {
        totalCards: hand.length,
        aces: 0,
        tens: 0,
        fives: 0,
        trumpCards: 0,
        suits: {}
    };

    suits.forEach(suit => {

        const cards =
            hand.filter(
                c => c.suit === suit
            );

        result.suits[suit] = {
            count: cards.length,

            ace:
                cards.filter(
                    c => c.value === 'A'
                ).length,

            king:
                cards.filter(
                    c => c.value === 'K'
                ).length,

            queen:
                cards.filter(
                    c => c.value === 'Q'
                ).length,

            ten:
                cards.filter(
                    c => c.value === '10'
                ).length,

            five:
                cards.filter(
                    c => c.value === '5'
                ).length
        };
    });

    result.aces =
        hand.filter(
            c => c.value === 'A'
        ).length;

    result.tens =
        hand.filter(
            c => c.value === '10'
        ).length;

    result.fives =
        hand.filter(
            c => c.value === '5'
        ).length;

    result.trumpCards =
        room.trumpSuit
            ? hand.filter(
                c =>
                    c.suit ===
                    room.trumpSuit
            ).length
            : 0;

    return result;
}
// =============================================================
// =============================================================
// 🎮 AI GAME CONNECTOR
// =============================================================
// =============================================================
//
// ส่วนนี้ทำหน้าที่:
//
// 1. ตรวจว่าเป็นตา AI หรือไม่
// 2. ให้ AI คิดก่อนเล่น
// 3. เลือกไพ่ตาม P1 / P2 / P3 / P4
// 4. อัปเดตข้อมูลว่าใครหมดดอกอะไร
// 5. ส่งไพ่ให้ระบบเกม
// 6. จบรอบ
// 7. เริ่มรอบใหม่
//
// =============================================================


// =============================================================
// ตรวจว่า seat นี้เป็น AI หรือไม่
// =============================================================
function isAIPlayer(room, seatIndex) {

    if (!room) {
        return false;
    }

    // ---------------------------------------------------------
    // รูปแบบที่ 1
    // room.players
    // ---------------------------------------------------------
    if (room.players) {

        const player =
            room.players[seatIndex];

        if (player) {

            if (
                player.isAI === true ||
                player.ai === true ||
                player.type === 'AI'
            ) {
                return true;
            }
        }
    }

    // ---------------------------------------------------------
    // รูปแบบที่ 2
    // room.aiPlayers
    // ---------------------------------------------------------
    if (
        room.aiPlayers &&
        room.aiPlayers.includes(seatIndex)
    ) {
        return true;
    }

    // ---------------------------------------------------------
    // รูปแบบที่ 3
    // room.aiSeats
    // ---------------------------------------------------------
    if (
        room.aiSeats &&
        room.aiSeats.includes(seatIndex)
    ) {
        return true;
    }

    // ---------------------------------------------------------
    // รูปแบบที่ 4
    // ถ้าไม่ได้กำหนด player data
    // ให้ถือว่า seat 1 และ 3 เป็น AI
    //
    // ถ้าเกมของคุณกำหนด AI คนละตำแหน่ง
    // ให้แก้ตรงนี้ได้
    // ---------------------------------------------------------
    if (
        room.aiSeats === undefined &&
        room.aiPlayers === undefined &&
        !room.players
    ) {

        return (
            seatIndex === 1 ||
            seatIndex === 3
        );
    }

    return false;
}


// =============================================================
// ตรวจว่าเป็นตาของใคร
// =============================================================
function isPlayerTurn(
    room,
    seatIndex
) {

    if (!room) {
        return false;
    }

    return (
        room.currentPlayer === seatIndex
    );
}


// =============================================================
// ตั้ง currentPlayer
// =============================================================
function setCurrentPlayer(
    room,
    seatIndex
) {

    room.currentPlayer =
        seatIndex;
}


// =============================================================
// หา player คนถัดไป
// =============================================================
function getNextPlayer(
    seatIndex
) {

    return (
        seatIndex + 1
    ) % 4;
}


// =============================================================
// ตรวจว่ารอบนี้มีไพ่ครบ 4 ใบแล้วหรือยัง
// =============================================================
function isRoundComplete(room) {

    if (
        !room.currentRoundCards
    ) {
        return false;
    }

    return room.currentRoundCards.every(
        card => card !== null
    );
}


// =============================================================
// อัปเดตข้อมูล Void Suit
//
// ตัวอย่าง:
//
// P1 ออก ♥
// P2 ไม่ออก ♥
// P2 ออก ♠
//
// แปลว่า P2 ไม่มี ♥
//
// AI จะจดจำข้อมูลนี้ไว้
// =============================================================
function updateVoidSuitFromRound(room) {

    if (
        !room.currentRoundCards
    ) {
        return;
    }

    const starter =
        room.starterPlayer;

    const leadCard =
        room.currentRoundCards[
            starter
        ];

    if (!leadCard) {
        return;
    }

    const leadSuit =
        leadCard.suit;

    for (let seat = 0; seat < 4; seat++) {

        const card =
            room.currentRoundCards[seat];

        if (!card) {
            continue;
        }

        if (
            card.suit !== leadSuit
        ) {

            markVoidSuit(
                room,
                seat,
                leadSuit
            );
        }
    }

    updateAIKnowledge(room);
}


// =============================================================
// บันทึกไพ่ที่เล่นลง playedHistory
//
// ฟังก์ชันนี้ป้องกันการบันทึกซ้ำ
// =============================================================
function rememberPlayedCard(
    room,
    card
) {

    if (!card) {
        return;
    }

    if (!room.playedHistory) {
        room.playedHistory = [];
    }

    const exists =
        room.playedHistory.some(
            c =>
                c.suit === card.suit &&
                c.value === card.value
        );

    if (!exists) {
        room.playedHistory.push(card);
    }
}


// =============================================================
// ประเมินไพ่ที่ AI กำลังจะเล่น
//
// ใช้ debug / log
// ไม่ได้เปลี่ยนผลการเลือกไพ่
// =============================================================
function explainAIDecision(
    room,
    seatIndex,
    selected
) {

    const position =
        getPlayPosition(
            room,
            seatIndex
        );

    let positionName =
        'P1';

    if (position === 1) {
        positionName = 'P2';
    }

    if (position === 2) {
        positionName = 'P3';
    }

    if (position === 3) {
        positionName = 'P4';
    }

    const winning =
        getCurrentWinningCard(room);

    return {
        seat: seatIndex,
        position: positionName,

        selectedCard:
            selected
                ? selected.card
                : null,

        currentWinner:
            winning.seat,

        currentWinningCard:
            winning.card,

        partner:
            getPartnerSeat(
                seatIndex
            ),

        dealer:
            room.dealer,

        trumpSuit:
            room.trumpSuit,

        roundPoints:
            getCurrentRoundPoints(room)
    };
}


// =============================================================
// ให้ AI เลือกไพ่
//
// return:
//
// {
//   idx: index ใน hand,
//   card: ไพ่,
//   reason: ข้อมูลสำหรับ debug
// }
// =============================================================
function selectAICard(
    room,
    seatIndex
) {

    const hand =
        room.hands[seatIndex] || [];

    if (hand.length === 0) {
        return null;
    }

    const index =
        getSmartAICardIndex(
            room,
            seatIndex
        );

    if (
        index === undefined ||
        index === null ||
        !hand[index]
    ) {

        return {
            idx: 0,
            card: hand[0],
            reason: null
        };
    }

    const legal =
        getLegalCards(
            room,
            seatIndex
        );

    const selected =
        legal.find(
            item =>
                item.idx === index
        );

    return {
        idx: index,
        card:
            selected
                ? selected.card
                : hand[index],
        reason:
            explainAIDecision(
                room,
                seatIndex,
                selected
            )
    };
}


// =============================================================
// เล่นไพ่โดย AI
// =============================================================
function playAICard(
    room,
    seatIndex
) {

    if (!room) {
        return false;
    }

    if (
        room.gameState === 'END'
    ) {
        return false;
    }

    if (
        !isPlayerTurn(
            room,
            seatIndex
        )
    ) {
        return false;
    }

    const selected =
        selectAICard(
            room,
            seatIndex
        );

    if (!selected) {
        return false;
    }

    const card =
        selected.card;

    const hand =
        room.hands[seatIndex];

    // ---------------------------------------------------------
    // ตรวจว่าไพ่ยังอยู่ในมือจริง
    // ---------------------------------------------------------
    if (
        !hand ||
        !hand[selected.idx]
    ) {
        return false;
    }

    // ---------------------------------------------------------
    // ตรวจว่าไพ่ถูกต้องตามกติกาหรือไม่
    // ---------------------------------------------------------
    const legalCards =
        getLegalCards(
            room,
            seatIndex
        );

    const isLegal =
        legalCards.some(
            item =>
                item.idx ===
                selected.idx
        );

    if (!isLegal) {

        // -----------------------------------------------------
        // Safety:
        // ถ้า AI เลือกผิด
        // ใช้ไพ่ใบแรกที่ถูกกติกาแทน
        // -----------------------------------------------------
        if (
            legalCards.length === 0
        ) {
            return false;
        }

        selected.idx =
            legalCards[0].idx;

        selected.card =
            legalCards[0].card;
    }

    // ---------------------------------------------------------
    // ตรวจอีกครั้งว่า currentRoundCards มีหรือไม่
    // ---------------------------------------------------------
    if (
        !room.currentRoundCards
    ) {

        room.currentRoundCards =
            [null, null, null, null];
    }

    // ---------------------------------------------------------
    // ใส่ไพ่ลงโต๊ะ
    // ---------------------------------------------------------
    room.currentRoundCards[
        seatIndex
    ] = selected.card;

    // ---------------------------------------------------------
    // ลบไพ่จากมือ
    // ---------------------------------------------------------
    room.hands[seatIndex].splice(
        selected.idx,
        1
    );

    // ---------------------------------------------------------
    // จำไพ่
    // ---------------------------------------------------------
    rememberPlayedCard(
        room,
        selected.card
    );

    // ---------------------------------------------------------
    // ตรวจ void suit
    // ---------------------------------------------------------
    updateVoidSuitFromRound(room);

    // ---------------------------------------------------------
    // Debug
    // ---------------------------------------------------------
    if (
        room.debugAI === true
    ) {

        console.log(
            '[AI PLAY]',
            JSON.stringify(
                selected.reason,
                null,
                2
            )
        );
    }

    // ---------------------------------------------------------
    // แจ้ง client
    // ---------------------------------------------------------
    emitGameState(room);

    // ---------------------------------------------------------
    // ถ้าครบ 4 ใบ
    // ---------------------------------------------------------
    if (
        isRoundComplete(room)
    ) {

        // รอเล็กน้อยเพื่อให้ผู้เล่นเห็นไพ่บนโต๊ะ
        setTimeout(
            () => {

                if (
                    room.gameState !== 'END'
                ) {

                    resolveRound(
                        room
                    );
                }

            },
            room.roundDelay || 900
        );

        return true;
    }

    // ---------------------------------------------------------
    // คนต่อไป
    // ---------------------------------------------------------
    const nextPlayer =
        getNextPlayer(
            seatIndex
        );

    setCurrentPlayer(
        room,
        nextPlayer
    );

    emitGameState(room);

    // ---------------------------------------------------------
    // ถ้าคนต่อไปเป็น AI
    // ให้ AI เล่นต่อ
    // ---------------------------------------------------------
    checkAITurn(room);

    return true;
}


// =============================================================
// ตรวจว่า AI ต้องเล่นหรือไม่
// =============================================================
function checkAITurn(room) {

    if (!room) {
        return;
    }

    if (
        room.gameState === 'END'
    ) {
        return;
    }

    if (
        room.gameState !== 'PLAYING'
    ) {
        return;
    }

    const current =
        room.currentPlayer;

    if (
        current === undefined ||
        current === null
    ) {
        return;
    }

    if (
        !isAIPlayer(
            room,
            current
        )
    ) {
        return;
    }

    // ---------------------------------------------------------
    // ป้องกัน AI เล่นซ้อน
    // ---------------------------------------------------------
    if (
        room.aiThinking
    ) {
        return;
    }

    room.aiThinking = true;

    // ---------------------------------------------------------
    // ให้ AI มีเวลาคิด
    //
    // ทำให้ดูเหมือนผู้เล่นจริง
    // ---------------------------------------------------------
    const thinkingTime =
        room.aiThinkingTime ||
        500 +
        Math.floor(
            Math.random() * 700
        );

    setTimeout(
        () => {

            room.aiThinking = false;

            // -------------------------------------------------
            // ตรวจอีกครั้ง
            // -------------------------------------------------
            if (
                room.gameState === 'END'
            ) {
                return;
            }

            if (
                room.currentPlayer !==
                current
            ) {
                return;
            }

            playAICard(
                room,
                current
            );

        },
        thinkingTime
    );
}


// =============================================================
// ส่ง Game State ให้ Client
//
// IMPORTANT:
//
// ห้ามส่งไพ่ในมือของ AI/ผู้เล่นคนอื่น
// ถ้าเกมต้องซ่อนไพ่
//
// ฟังก์ชันนี้เป็น wrapper
// =============================================================
function emitGameState(room) {

    if (
        typeof io === 'undefined'
    ) {
        return;
    }

    if (
        !room ||
        !room.id
    ) {
        return;
    }

    // ---------------------------------------------------------
    // ถ้าเกมเดิมมีฟังก์ชันส่ง state อยู่แล้ว
    // ใช้ฟังก์ชันเดิม
    // ---------------------------------------------------------
    if (
        typeof sendGameState === 'function'
    ) {

        try {

            sendGameState(
                room
            );

            return;

        } catch (err) {

            console.error(
                'sendGameState error:',
                err
            );
        }
    }

    // ---------------------------------------------------------
    // fallback
    // ---------------------------------------------------------
    io.to(room.id).emit(
        'updateGameState',
        room
    );
}


// =============================================================
// =============================================================
// 🃏 ระบบประมูล / เลือกเจ้ามือ
// =============================================================
// =============================================================
//
// ถ้าเกมของคุณมีระบบประมูลอยู่แล้ว
// สามารถใช้ฟังก์ชันเดิมได้
//
// ส่วนนี้เป็น helper สำหรับ AI
// =============================================================


// =============================================================
// ประเมินความแข็งแรงของดอก
// =============================================================
function evaluateSuitStrength(
    room,
    hand,
    suit
) {

    const cards =
        hand.filter(
            c => c.suit === suit
        );

    if (
        cards.length === 0
    ) {
        return 0;
    }

    let score = 0;

    cards.forEach(card => {

        if (card.value === 'A') {
            score += 12;
        }

        else if (
            card.value === 'K'
        ) {
            score += 7;
        }

        else if (
            card.value === 'Q'
        ) {
            score += 5;
        }

        else if (
            card.value === 'J'
        ) {
            score += 4;
        }

        else if (
            card.value === '10'
        ) {
            score += 6;
        }

        else if (
            card.value === '5'
        ) {
            score += 3;
        }

        else {
            score += 1;
        }
    });

    // ดอกที่มีจำนวนมาก
    // ได้โบนัสเพราะมีโอกาสควบคุมดอก
    if (cards.length >= 5) {
        score += 8;
    }

    if (cards.length >= 6) {
        score += 5;
    }

    // A + K
    if (
        cards.some(
            c => c.value === 'A'
        ) &&
        cards.some(
            c => c.value === 'K'
        )
    ) {
        score += 8;
    }

    // A + 10
    if (
        cards.some(
            c => c.value === 'A'
        ) &&
        cards.some(
            c => c.value === '10'
        )
    ) {
        score += 5;
    }

    return score;
}


// =============================================================
// AI เลือกดอกหลัก
// =============================================================
function chooseAITrumpSuit(
    room,
    seatIndex
) {

    const hand =
        room.hands[seatIndex] || [];

    const suits = [
        '♠',
        '♥️',
        '♣',
        '♦️'
    ];

    let evaluations =
        suits.map(
            suit => ({
                suit,
                score:
                    evaluateSuitStrength(
                        room,
                        hand,
                        suit
                    )
            })
        );

    evaluations.sort(
        (a, b) =>
            b.score - a.score
    );

    if (
        evaluations.length === 0
    ) {
        return suits[0];
    }

    return evaluations[0].suit;
}


// =============================================================
// ประเมินความสามารถในการเป็นเจ้ามือ
// =============================================================
function evaluateAIBid(
    room,
    seatIndex
) {

    const hand =
        room.hands[seatIndex] || [];

    let total = 0;

    hand.forEach(card => {

        if (card.value === 'A') {
            total += 8;
        }

        else if (
            card.value === 'K'
        ) {
            total += 5;
        }

        else if (
            card.value === 'Q'
        ) {
            total += 3;
        }

        else if (
            card.value === 'J'
        ) {
            total += 2;
        }

        else if (
            card.value === '10'
        ) {
            total += 6;
        }

        else if (
            card.value === '5'
        ) {
            total += 3;
        }
    });

    // ไพ่หลักเยอะ
    const suitScores = [
        '♠',
        '♥️',
        '♣',
        '♦️'
    ].map(
        suit =>
            evaluateSuitStrength(
                room,
                hand,
                suit
            )
    );

    total +=
        Math.max(
            ...suitScores
        );

    return total;
}


// =============================================================
// AI ตัดสินใจว่าจะประมูลหรือไม่
//
// สามารถปรับ threshold ได้
// =============================================================
function shouldAIBid(
    room,
    seatIndex,
    currentBid
) {

    const strength =
        evaluateAIBid(
            room,
            seatIndex
        );

    // ---------------------------------------------------------
    // ยิ่ง bid สูง
    // ต้องมีไพ่แข็งแรงมากขึ้น
    // ---------------------------------------------------------
    const threshold =
        38 +
        (
            currentBid || 0
        ) * 3;

    return (
        strength >= threshold
    );
}


// =============================================================
// AI เลือกดอกหลังชนะประมูล
// =============================================================
function setAIAsDealer(
    room,
    seatIndex
) {

    room.dealer =
        seatIndex;

    room.trumpSuit =
        chooseAITrumpSuit(
            room,
            seatIndex
        );

    room.aiDealerStrength =
        evaluateAIBid(
            room,
            seatIndex
        );

    return {
        dealer:
            room.dealer,

        trumpSuit:
            room.trumpSuit,

        strength:
            room.aiDealerStrength
    };
}


// =============================================================
// =============================================================
// 🧠 AI ADVANCED MEMORY
// =============================================================
// =============================================================


// =============================================================
// สร้างข้อมูลไพ่ที่ยังไม่ออก
// =============================================================
function getRemainingCards(
    room
) {

    const allCards =
        typeof createDeck === 'function'
            ? createDeck()
            : [];

    if (
        allCards.length === 0
    ) {
        return [];
    }

    return allCards.filter(
        card =>
            !room.playedHistory.some(
                played =>
                    played.suit === card.suit &&
                    played.value === card.value
            )
    );
}


// =============================================================
// ตรวจว่า A ของดอกนี้ออกไปแล้วหรือยัง
// =============================================================
function hasAceBeenPlayed(
    room,
    suit
) {

    return room.playedHistory.some(
        card =>
            card.suit === suit &&
            card.value === 'A'
    );
}


// =============================================================
// ตรวจว่า 10 ของดอกนี้ออกไปแล้วหรือยัง
// =============================================================
function hasTenBeenPlayed(
    room,
    suit
) {

    return room.playedHistory.some(
        card =>
            card.suit === suit &&
            card.value === '10'
    );
}


// =============================================================
// ตรวจว่า 5 ของดอกนี้ออกไปแล้วหรือยัง
// =============================================================
function hasFiveBeenPlayed(
    room,
    suit
) {

    return room.playedHistory.some(
        card =>
            card.suit === suit &&
            card.value === '5'
    );
}


// =============================================================
// คำนวณความปลอดภัยของไพ่คะแนน
//
// ยิ่งสูง = ยิ่งควรเก็บ
// =============================================================
function getPointProtectionScore(
    room,
    seatIndex,
    card
) {

    if (
        !card
    ) {
        return 0;
    }

    let score = 0;

    if (card.value === 'A') {
        score += 40;
    }

    if (card.value === '10') {
        score += 25;
    }

    if (card.value === '5') {
        score += 15;
    }

    // ---------------------------------------------------------
    // ถ้าเป็นดอกหลัก
    // ไพ่คะแนนมีค่าในการชนะสูงขึ้น
    // ---------------------------------------------------------
    if (
        card.suit === room.trumpSuit
    ) {
        score += 20;
    }

    // ---------------------------------------------------------
    // ถ้าเจ้ามือฝ่ายตรงข้ามหมดดอกนี้
    //
    // ไพ่คะแนนดอกนี้อาจมีประโยชน์
    // ---------------------------------------------------------
    if (
        room.dealer !== -1 &&
        playerHasVoidSuit(
            room,
            room.dealer,
            card.suit
        )
    ) {
        score += 25;
    }

    // ---------------------------------------------------------
    // ถ้า A ของดอกนี้ยังไม่ออก
    // A ของเรามีความสำคัญ
    // ---------------------------------------------------------
    if (
        card.value !== 'A' &&
        !hasAceBeenPlayed(
            room,
            card.suit
        )
    ) {
        score += 5;
    }

    return score;
}


// =============================================================
// เลือกไพ่ที่ควรเก็บ
// =============================================================
function getProtectedCards(
    room,
    seatIndex
) {

    const hand =
        room.hands[seatIndex] || [];

    return hand
        .filter(
            card =>
                isDangerPointCard(card)
        )
        .map(
            card => ({
                card,

                score:
                    getPointProtectionScore(
                        room,
                        seatIndex,
                        card
                    )
            })
        )
        .sort(
            (a, b) =>
                b.score - a.score
        );
}


// =============================================================
// ตรวจสถานการณ์:
//
// เพื่อนเป็นเจ้ามือ
// และ AI มี A
//
// A ควรพยายามเก็บไว้
// เพื่อรอจังหวะเปิด
// =============================================================
function shouldSaveAceForPartnerDealer(
    room,
    seatIndex,
    card
) {

    if (
        !card ||
        card.value !== 'A'
    ) {
        return false;
    }

    if (
        !isPartnerDealer(
            room,
            seatIndex
        )
    ) {
        return false;
    }

    // ---------------------------------------------------------
    // ถ้าเป็นดอกหลัก
    // ยิ่งควรเก็บ
    // ---------------------------------------------------------
    if (
        card.suit ===
        room.trumpSuit
    ) {
        return true;
    }

    // ---------------------------------------------------------
    // ถ้า A ดอกนี้ยังไม่ออก
    // มีโอกาสใช้เป็นไพ่เปิด
    // ---------------------------------------------------------
    if (
        !hasAceBeenPlayed(
            room,
            card.suit
        )
    ) {
        return true;
    }

    return false;
}


// =============================================================
// เลือกไพ่สำหรับสถานการณ์ที่ต้อง "ทิ้ง"
// =============================================================
function chooseDiscardCard(
    room,
    seatIndex,
    legalCards
) {

    if (
        legalCards.length === 0
    ) {
        return null;
    }

    // ---------------------------------------------------------
    // 1. ไพ่เล็กที่สุดที่ไม่ใช่คะแนน
    // ---------------------------------------------------------
    const smallNonPoint =
        getSmallestNonPointCard(
            legalCards
        );

    if (smallNonPoint) {
        return smallNonPoint;
    }

    // ---------------------------------------------------------
    // 2. 5 ก่อน 10
    // ---------------------------------------------------------
    const five =
        legalCards.find(
            item =>
                item.card.value === '5'
        );

    if (five) {
        return five;
    }

    const ten =
        legalCards.find(
            item =>
                item.card.value === '10'
        );

    if (ten) {
        return ten;
    }

    // ---------------------------------------------------------
    // 3. A เป็นใบสุดท้าย
    // ---------------------------------------------------------
    const ace =
        legalCards.find(
            item =>
                item.card.value === 'A'
        );

    if (ace) {
        return ace;
    }

    return legalCards[0];
}


// =============================================================
// =============================================================
// 🔧 INITIALIZE ROOM AI DATA
// =============================================================
// =============================================================
function initializeAIData(room) {

    if (!room) {
        return;
    }

    if (
        !room.playedHistory
    ) {
        room.playedHistory = [];
    }

    if (
        !room.currentRoundCards
    ) {
        room.currentRoundCards =
            [null, null, null, null];
    }

    if (
        !room.voidSuits
    ) {

        room.voidSuits = [
            [],
            [],
            [],
            []
        ];
    }

    if (
        !room.cardKnowledge
    ) {
        room.cardKnowledge = {};
    }

    if (
        room.roundCount === undefined
    ) {
        room.roundCount = 0;
    }

    if (
        room.teamAScore === undefined
    ) {
        room.teamAScore = 0;
    }

    if (
        room.teamBScore === undefined
    ) {
        room.teamBScore = 0;
    }

    if (
        room.teamACapturedCards === undefined
    ) {
        room.teamACapturedCards = [];
    }

    if (
        room.teamBCapturedCards === undefined
    ) {
        room.teamBCapturedCards = [];
    }

    if (
        room.aiThinkingTime === undefined
    ) {
        room.aiThinkingTime = 500;
    }

    if (
        room.roundDelay === undefined
    ) {
        room.roundDelay = 900;
    }

    room.aiThinking = false;
}


// =============================================================
// =============================================================
// 🚀 START GAME
// =============================================================
// =============================================================

function initializeGameForAI(room) {

    initializeAIData(room);

    // ---------------------------------------------------------
    // ถ้ายังไม่มี trump
    // และมี dealer แล้ว
    // ให้ AI เลือกดอกหลัก
    // ---------------------------------------------------------
    if (
        room.dealer !== undefined &&
        room.dealer !== -1 &&
        !room.trumpSuit
    ) {

        room.trumpSuit =
            chooseAITrumpSuit(
                room,
                room.dealer
            );
    }

    // ---------------------------------------------------------
    // ถ้ายังไม่มี currentPlayer
    // ให้ dealer เป็นคนเริ่ม
    // ---------------------------------------------------------
    if (
        room.currentPlayer === undefined ||
        room.currentPlayer === null
    ) {

        if (
            room.dealer !== undefined &&
            room.dealer !== -1
        ) {

            room.currentPlayer =
                room.dealer;

            room.starterPlayer =
                room.dealer;
        }
    }

    // ---------------------------------------------------------
    // เริ่ม AI
    // ---------------------------------------------------------
    checkAITurn(room);
}


// =============================================================
// =============================================================
// 🔄 AFTER ROUND
// =============================================================
// =============================================================
//
// ใช้กรณีระบบเกมเดิมไม่ได้เรียก checkAITurn()
// หลัง resolveRound()
// =============================================================
function afterRoundForAI(room) {

    if (!room) {
        return;
    }

    initializeAIData(room);

    updateAIKnowledge(room);

    if (
        room.gameState === 'END'
    ) {
        emitGameState(room);
        return;
    }

    // ---------------------------------------------------------
    // คนชนะรอบเป็นคนเปิด
    // ---------------------------------------------------------
    if (
        room.starterPlayer !== undefined
    ) {

        room.currentPlayer =
            room.starterPlayer;
    }

    emitGameState(room);

    checkAITurn(room);
}


// =============================================================
// =============================================================
// 🛡️ SAFETY VALIDATION
// =============================================================
// =============================================================


// =============================================================
// ตรวจว่าไพ่ในมือไม่ซ้ำ
// =============================================================
function validateHands(room) {

    if (!room.hands) {
        return true;
    }

    const seen = new Set();

    for (
        let seat = 0;
        seat < room.hands.length;
        seat++
    ) {

        const hand =
            room.hands[seat] || [];

        for (
            let i = 0;
            i < hand.length;
            i++
        ) {

            const card =
                hand[i];

            const key =
                `${card.suit}_${card.value}`;

            if (
                seen.has(key)
            ) {

                console.error(
                    'Duplicate card:',
                    key
                );

                return false;
            }

            seen.add(key);
        }
    }

    return true;
}


// =============================================================
// ตรวจว่า AI มีไพ่ถูกต้องตามกติกา
// =============================================================
function validateAIPlay(
    room,
    seatIndex,
    card
) {

    if (!card) {
        return false;
    }

    const hand =
        room.hands[seatIndex] || [];

    const index =
        hand.findIndex(
            c =>
                c.suit === card.suit &&
                c.value === card.value
        );

    if (index === -1) {
        return false;
    }

    const legal =
        getLegalCards(
            room,
            seatIndex
        );

    return legal.some(
        item =>
            item.idx === index
    );
}


// =============================================================
// =============================================================
// 📊 DEBUG AI
// =============================================================
// =============================================================

function debugAIState(
    room,
    seatIndex
) {

    if (
        !room ||
        room.debugAI !== true
    ) {
        return;
    }

    const hand =
        room.hands[seatIndex] || [];

    const position =
        getPlayPosition(
            room,
            seatIndex
        );

    const winning =
        getCurrentWinningCard(
            room
        );

    console.log(
        '========================================'
    );

    console.log(
        '[AI DEBUG]'
    );

    console.log(
        'Seat:',
        seatIndex
    );

    console.log(
        'Position:',
        position + 1
    );

    console.log(
        'Dealer:',
        room.dealer
    );

    console.log(
        'Trump:',
        room.trumpSuit
    );

    console.log(
        'Current player:',
        room.currentPlayer
    );

    console.log(
        'Hand:',
        hand
    );

    console.log(
        'Table:',
        room.currentRoundCards
    );

    console.log(
        'Current winner:',
        winning
    );

    console.log(
        'Void suits:',
        room.voidSuits
    );

    console.log(
        'Played:',
        room.playedHistory
    );

    console.log(
        '========================================'
    );
}


// =============================================================
// =============================================================
// 🔌 OPTIONAL SOCKET EVENTS
// =============================================================
// =============================================================
//
// ถ้า server เดิมมี socket.io
// สามารถใช้ event นี้เพื่อเปิด/ปิด debug AI
// =============================================================

function registerAISocketEvents() {

    if (
        typeof io === 'undefined'
    ) {
        return;
    }

    io.on(
        'connection',
        socket => {

            socket.on(
                'setAIDebug',
                data => {

                    if (
                        !data ||
                        !data.roomId
                    ) {
                        return;
                    }

                    const room =
                        rooms &&
                        rooms[data.roomId];

                    if (!room) {
                        return;
                    }

                    room.debugAI =
                        data.enabled === true;
                }
            );
        }
    );
}


// =============================================================
// =============================================================
// 🚀 SERVER START
// =============================================================
// =============================================================
//
// ถ้าไฟล์เดิมของคุณมี server.listen()
// อยู่แล้ว:
//
// ❗ ไม่ต้องใส่ server.listen() ซ้ำ
//
// ให้ใช้เฉพาะส่วน AI ด้านบน
//
// ถ้าไม่มี server.listen() เดิม
// สามารถใช้ตัวอย่างด้านล่าง
// =============================================================

function startServer() {

    const PORT =
        process.env.PORT || 3000;

    if (
        typeof server === 'undefined'
    ) {

        console.error(
            'ไม่พบตัวแปร server'
        );

        return;
    }

    server.listen(
        PORT,
        () => {

            console.log(
                `Server started on port ${PORT}`
            );

        }
    );
}


// =============================================================
// =============================================================
// 🧪 TEST AI
// =============================================================
// =============================================================
//
// เรียก:
//
// testAI(room, 1)
//
// เพื่อดูว่า AI seat 1 เลือกไพ่อะไร
// =============================================================

function testAI(
    room,
    seatIndex
) {

    initializeAIData(room);

    debugAIState(
        room,
        seatIndex
    );

    const result =
        selectAICard(
            room,
            seatIndex
        );

    console.log(
        '[AI TEST RESULT]',
        result
    );

    return result;
}


// =============================================================
// =============================================================
// 🎯 EXPORT
// =============================================================
// =============================================================
//
// ถ้าไฟล์นี้ใช้ Node.js module
// สามารถ export function สำคัญออกไปได้
//
// ถ้า server.js ของคุณไม่ได้ใช้ module.exports
// ส่วนนี้สามารถลบออกได้
// =============================================================

if (
    typeof module !== 'undefined' &&
    module.exports
) {

    module.exports = {

        // AI core
        getSmartAICardIndex,
        selectAICard,
        playAICard,
        checkAITurn,

        // P1-P4
        chooseP1Card,
        chooseP2Card,
        chooseP3Card,
        chooseP4Card,

        // Analysis
        getCurrentWinningCard,
        getLegalCards,
        getSmallestWinningCard,
        getSmallestNonPointCard,
        getLargestNonPointCard,

        // Memory
        updateAIKnowledge,
        updateVoidSuitFromRound,
        markVoidSuit,

        // Dealer
        chooseAITrumpSuit,
        evaluateAIBid,
        shouldAIBid,
        setAIAsDealer,

        // Game
        initializeAIData,
        initializeGameForAI,
        afterRoundForAI,

        // Debug
        debugAIState,
        testAI
    };
}
