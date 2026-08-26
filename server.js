const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const rooms = {};

const CARD_RANKS = {
    '2': 1, '3': 2, '4': 3, '5': 4, '6': 5, '7': 6, '8': 7,
    '9': 8, '10': 9, 'J': 10, 'Q': 11, 'K': 12, 'A': 13
};

const SUIT_RANKS = {
    '♠': 1,
    '♥️': 2,
    '♣': 3,
    '♦️': 4
};

function createDeck() {
    const suits = ['♠', '♥️', '♣', '♦️'];
    const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    let deck = [];
    for (let s of suits) {
        for (let v of values) {
            deck.push({ suit: s, value: v });
        }
    }
    return deck.sort(() => Math.random() - 0.5);
}

function calculateCardScore(card) {
    if (card.value === '5') return 5;
    if (card.value === '10' || card.value === 'A') return 10;
    return 0;
}

function sortCards(a, b) {
    if (SUIT_RANKS[a.suit] !== SUIT_RANKS[b.suit]) {
        return SUIT_RANKS[a.suit] - SUIT_RANKS[b.suit];
    }
    return CARD_RANKS[b.value] - CARD_RANKS[a.value];
}

function createRoomObject(roomId, is1v1 = false) {
    return {
        id: roomId,
        is1v1: is1v1,
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
        playedHistory: [],
        voidSuits: { 0: [], 1: [], 2: [], 3: [] }
    };
}

io.on('connection', (socket) => {
    
    socket.on('createRoom', ({ playerName, is1v1 }) => {
        const roomId = Math.floor(1000 + Math.random() * 9000).toString();
        const room = createRoomObject(roomId, is1v1);
        
        if (is1v1) {
            // โหมด 1v1: ผู้สร้างคุมที่นั่ง 0 และ 2
            room.seats[0] = { id: socket.id, name: `${playerName} (1)`, isAI: false, seat: 0 };
            room.seats[2] = { id: socket.id, name: `${playerName} (2)`, isAI: false, seat: 2 };
        } else {
            room.seats[0] = { id: socket.id, name: playerName, isAI: false, seat: 0 };
        }

        rooms[roomId] = room;
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, seat: 0 });
        io.to(roomId).emit('updateRoom', room);
        
        io.to(roomId).emit('newChatMessage', {
            senderName: 'ระบบ',
            message: `🎉 คุณ ${playerName} สร้างห้องพักสำเร็จ ${is1v1 ? '(โหมด 1 VS 1)' : ''}`,
            isSystem: true
        });
    });

    socket.on('createSinglePlayer', (playerName) => {
        const roomId = Math.floor(1000 + Math.random() * 9000).toString();
        const room = createRoomObject(roomId, false);
        room.seats[0] = { id: socket.id, name: playerName, isAI: false, seat: 0 };
        for (let i = 1; i <= 3; i++) {
            room.seats[i] = { id: `bot-${i}`, name: `บอท AI ${i}`, isAI: true, seat: i };
        }
        rooms[roomId] = room;
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, seat: 0 });
        io.to(roomId).emit('updateRoom', room);
        
        io.to(roomId).emit('newChatMessage', {
            senderName: 'ระบบ',
            message: `🤖 เริ่มเกมโหมดเล่นกับบอทแล้ว`,
            isSystem: true
        });
    });

    socket.on('joinRoom', ({ roomId, playerName }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('errorMessage', 'ไม่พบห้องนี้');

        if (room.is1v1) {
            // โหมด 1v1: คนที่สองจะได้เก้าอี้ 1 และ 3
            if (room.seats[1] !== null) return socket.emit('errorMessage', 'ห้องเต็มแล้ว');
            room.seats[1] = { id: socket.id, name: `${playerName} (1)`, isAI: false, seat: 1 };
            room.seats[3] = { id: socket.id, name: `${playerName} (2)`, isAI: false, seat: 3 };
            socket.join(roomId);
            socket.emit('joinedSuccess', { roomId, seat: 1 });
        } else {
            let emptySeat = room.seats.findIndex(s => s === null);
            if (emptySeat === -1) return socket.emit('errorMessage', 'ห้องเต็มแล้ว');

            room.seats[emptySeat] = { id: socket.id, name: playerName, isAI: false, seat: emptySeat };
            socket.join(roomId);
            socket.emit('joinedSuccess', { roomId, seat: emptySeat });
        }

        io.to(roomId).emit('updateRoom', room);
        io.to(roomId).emit('newChatMessage', {
            senderName: 'ระบบ',
            message: `👋 คุณ ${playerName} เข้าร่วมห้องแล้ว`,
            isSystem: true
        });
    });

    socket.on('sendChatMessage', ({ roomId, message }) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.seats.find(s => s && s.id === socket.id);
        const senderName = player ? player.name.replace(/ \([12]\)/, '') : 'ผู้รับชม';

        io.to(roomId).emit('newChatMessage', {
            senderId: socket.id,
            senderName: senderName,
            message: message,
            isSystem: false
        });
    });

    socket.on('changeSeat', ({ roomId, targetSeat }) => {
        const room = rooms[roomId];
        if (!room || room.gameState !== 'LOBBY' || room.is1v1) return;
        
        let currentSeat = room.seats.findIndex(s => s && s.id === socket.id);
        if (currentSeat !== -1 && room.seats[targetSeat] === null) {
            room.seats[targetSeat] = room.seats[currentSeat];
            room.seats[targetSeat].seat = targetSeat;
            room.seats[currentSeat] = null;
            io.to(roomId).emit('updateRoom', room);
        }
    });

    socket.on('fillAI', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room || room.gameState !== 'LOBBY' || room.is1v1) return;
        for (let i = 0; i < 4; i++) {
            if (room.seats[i] === null) {
                room.seats[i] = { id: `bot-${i}`, name: `บอท AI ${i}`, isAI: true, seat: i };
            }
        }
        io.to(roomId).emit('updateRoom', room);
    });

    socket.on('startGameReq', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room) return;
        if (room.seats.some(s => s === null)) return socket.emit('errorMessage', 'ที่นั่งยังไม่ครบ 4 เก้าอี้');

        startNewGame(room);
    });

    socket.on('submitBid', ({ roomId, bidValue, isPass }) => {
        const room = rooms[roomId];
        if (!room || room.gameState !== 'BIDDING') return;

        if (isPass) {
            room.consecutivePasses++;
        } else {
            if (bidValue > room.highestBid) {
                room.highestBid = bidValue;
                room.highestBidder = room.bidTurn;
                room.consecutivePasses = 0;
            }
        }

        if (room.consecutivePasses >= 3 && room.highestBidder !== -1) {
            room.dealer = room.highestBidder;
            room.gameState = 'SELECT_TRUMP';
            io.to(roomId).emit('updateGameState', room);
            checkAITurn(room);
            return;
        }

        room.bidTurn = (room.bidTurn + 1) % 4;
        io.to(roomId).emit('updateGameState', room);
        checkAITurn(room);
    });

    socket.on('selectTrump', ({ roomId, suit }) => {
        const room = rooms[roomId];
        if (!room || room.gameState !== 'SELECT_TRUMP') return;
        
        room.trumpSuit = suit;
        
        room.hands[room.dealer].push(...room.kitty);
        room.hands[room.dealer].sort(sortCards);
        room.kitty = [];

        sendHandToPlayer(room, room.dealer);

        room.gameState = 'KITTY_DISCARD';
        io.to(roomId).emit('updateGameState', room);
        checkAITurn(room);
    });

    socket.on('confirmDiscard', ({ roomId, discardIndexes }) => {
        const room = rooms[roomId];
        if (!room || room.gameState !== 'KITTY_DISCARD') return;

        let dealerHand = room.hands[room.dealer];
        discardIndexes.sort((a, b) => b - a);
        discardIndexes.forEach(idx => {
            room.kitty.push(dealerHand.splice(idx, 1)[0]);
        });

        dealerHand.sort(sortCards);

        sendHandToPlayer(room, room.dealer);

        room.gameState = 'PLAYING';
        room.starterPlayer = room.dealer;
        io.to(roomId).emit('updateGameState', room);
        checkAITurn(room);
    });

    socket.on('playCard', ({ roomId, seat, cardIndex }) => {
        const room = rooms[roomId];
        if (!room || room.gameState !== 'PLAYING') return;

        let currentTurn = getCurrentTurn(room);

        // ตรวจสอบทั้งแบบส่ง seat ตรงๆ มา และตรวจ socket owner
        let targetSeat = (seat !== undefined) ? seat : currentTurn;
        if (targetSeat !== currentTurn) return;

        let playerSeatObj = room.seats[currentTurn];
        if (playerSeatObj.id !== socket.id) return;

        executePlayCard(room, currentTurn, cardIndex);
    });

    socket.on('restartGameReq', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room) return;
        startNewGame(room);
    });
});

function sendHandToPlayer(room, seatIdx) {
    const player = room.seats[seatIdx];
    if (player && !player.isAI) {
        io.to(player.id).emit('yourHand', { seat: seatIdx, hand: room.hands[seatIdx] });
    }
}

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
    room.currentRoundCards = [null, null, null, null];
    room.playedHistory = [];
    room.voidSuits = { 0: [], 1: [], 2: [], 3: [] };

    for (let i = 0; i < 4; i++) {
        room.hands[i] = room.deck.splice(0, 12).sort(sortCards);
    }
    room.kitty = room.deck.splice(0, 4);

    room.bidTurn = Math.floor(Math.random() * 4);

    for (let i = 0; i < 4; i++) {
        sendHandToPlayer(room, i);
    }

    io.to(room.id).emit('updateGameState', room);
    checkAITurn(room);
}

function getCurrentTurn(room) {
    let playedCount = room.currentRoundCards.filter(c => c !== null).length;
    return (room.starterPlayer + playedCount) % 4;
}

function executePlayCard(room, seatIndex, cardIndex) {
    let hand = room.hands[seatIndex];
    let card = hand[cardIndex];

    let playedCount = room.currentRoundCards.filter(c => c !== null).length;
    if (playedCount > 0) {
        let leadCard = room.currentRoundCards[room.starterPlayer];
        let hasLeadSuit = hand.some(c => c.suit === leadCard.suit);
        if (hasLeadSuit && card.suit !== leadCard.suit) {
            return;
        }
        if (!hasLeadSuit && !room.voidSuits[seatIndex].includes(leadCard.suit)) {
            room.voidSuits[seatIndex].push(leadCard.suit);
        }
    }

    hand.splice(cardIndex, 1);
    room.currentRoundCards[seatIndex] = card;

    sendHandToPlayer(room, seatIndex);

    if (room.currentRoundCards.filter(c => c !== null).length === 4) {
        io.to(room.id).emit('updateGameState', room);
        setTimeout(() => resolveRound(room), 1500);
    } else {
        io.to(room.id).emit('updateGameState', room);
        checkAITurn(room);
    }
}

function resolveRound(room) {
    let leadCard = room.currentRoundCards[room.starterPlayer];
    let winningSeat = room.starterPlayer;
    let winningCard = leadCard;

    room.currentRoundCards.forEach(c => {
        if (c) room.playedHistory.push(c);
    });

    for (let i = 0; i < 4; i++) {
        if (i === room.starterPlayer) continue;
        let card = room.currentRoundCards[i];

        if (card.suit === winningCard.suit) {
            if (CARD_RANKS[card.value] > CARD_RANKS[winningCard.value]) {
                winningCard = card;
                winningSeat = i;
            }
        } else if (card.suit === room.trumpSuit && winningCard.suit !== room.trumpSuit) {
            winningCard = card;
            winningSeat = i;
        }
    }

    let roundPoints = 0;
    let pointCardsInRound = [];

    room.currentRoundCards.forEach(c => {
        let pts = calculateCardScore(c);
        roundPoints += pts;
        if (pts > 0) pointCardsInRound.push(c);
    });

    if (winningSeat === 0 || winningSeat === 2) {
        room.teamAScore += roundPoints;
        room.teamACapturedCards.push(...pointCardsInRound);
    } else {
        room.teamBScore += roundPoints;
        room.teamBCapturedCards.push(...pointCardsInRound);
    }

    room.starterPlayer = winningSeat;
    room.currentRoundCards = [null, null, null, null];
    room.roundCount++;

    if (room.roundCount >= 12) {
        let kittyPoints = 0;
        let kittyPointCards = [];
        room.kitty.forEach(c => {
            let pts = calculateCardScore(c);
            kittyPoints += pts * 2;
            if (pts > 0) kittyPointCards.push(c);
        });

        if (winningSeat === 0 || winningSeat === 2) {
            room.teamAScore += kittyPoints;
            room.teamACapturedCards.push(...kittyPointCards);
        } else {
            room.teamBScore += kittyPoints;
            room.teamBCapturedCards.push(...kittyPointCards);
        }

        room.gameState = 'END';
    }

    io.to(room.id).emit('updateGameState', room);
    checkAITurn(room);
}

function checkAITurn(room) {
    if (room.gameState === 'BIDDING') {
        let currentBot = room.seats[room.bidTurn];
        if (currentBot && currentBot.isAI) {
            setTimeout(() => {
                let bidValue = 0;
                let isPass = true;
                if (room.highestBid < 70 && Math.random() > 0.5) {
                    bidValue = room.highestBid + 5;
                    isPass = false;
                }
                socketEmitBid(room, bidValue, isPass);
            }, 1000);
        }
    } else if (room.gameState === 'SELECT_TRUMP') {
        let dealerBot = room.seats[room.dealer];
        if (dealerBot && dealerBot.isAI) {
            setTimeout(() => {
                const suits = ['♠', '♥️', '♣', '♦️'];
                room.trumpSuit = suits[Math.floor(Math.random() * suits.length)];
                
                room.hands[room.dealer].push(...room.kitty);
                room.hands[room.dealer].sort(sortCards);
                room.kitty = [];

                room.gameState = 'KITTY_DISCARD';
                io.to(room.id).emit('updateGameState', room);
                checkAITurn(room);
            }, 1000);
        }
    } else if (room.gameState === 'KITTY_DISCARD') {
        let dealerBot = room.seats[room.dealer];
        if (dealerBot && dealerBot.isAI) {
            setTimeout(() => {
                let hand = room.hands[room.dealer];
                let nonPointIndexes = [];
                hand.forEach((c, idx) => {
                    if (!['A', '10', '5'].includes(c.value)) nonPointIndexes.push(idx);
                });
                
                nonPointIndexes.sort(() => Math.random() - 0.5);
                let toDiscard = nonPointIndexes.slice(0, 4).sort((a, b) => b - a);

                toDiscard.forEach(idx => {
                    room.kitty.push(hand.splice(idx, 1)[0]);
                });

                hand.sort(sortCards);

                room.gameState = 'PLAYING';
                room.starterPlayer = room.dealer;
                io.to(room.id).emit('updateGameState', room);
                checkAITurn(room);
            }, 1000);
        }
    } else if (room.gameState === 'PLAYING') {
        let currentTurn = getCurrentTurn(room);
        let bot = room.seats[currentTurn];
        if (bot && bot.isAI) {
            setTimeout(() => {
                let chosenIndex = getSmartAICardIndex(room, currentTurn);
                executePlayCard(room, currentTurn, chosenIndex);
            }, 1000);
        }
    }
}

function socketEmitBid(room, bidValue, isPass) {
    if (isPass) {
        room.consecutivePasses++;
    } else {
        if (bidValue > room.highestBid) {
            room.highestBid = bidValue;
            room.highestBidder = room.bidTurn;
            room.consecutivePasses = 0;
        }
    }

    if (room.consecutivePasses >= 3 && room.highestBidder !== -1) {
        room.dealer = room.highestBidder;
        room.gameState = 'SELECT_TRUMP';
        io.to(room.id).emit('updateGameState', room);
        checkAITurn(room);
        return;
    }

    room.bidTurn = (room.bidTurn + 1) % 4;
    io.to(room.id).emit('updateGameState', room);
    checkAITurn(room);
}

function getSmartAICardIndex(room, seatIndex) {
    let hand = room.hands[seatIndex];
    let validCards = hand.map((card, idx) => ({ card, idx }));
    return validCards[0].idx;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
