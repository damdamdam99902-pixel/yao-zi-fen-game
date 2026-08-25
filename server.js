const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    pingTimeout: 30000,
    pingInterval: 10000
});

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
        playedHistory: [],
        voidSuits: { 0: [], 1: [], 2: [], 3: [] },
        timerInterval: null,
        timeLeft: 15
    };
}

io.on('connection', (socket) => {
    
    socket.on('createRoom', (playerName) => {
        const roomId = Math.floor(1000 + Math.random() * 9000).toString();
        rooms[roomId] = createRoomObject(roomId);
        rooms[roomId].seats[0] = { id: socket.id, name: playerName, isAI: false, isAutoBot: false, seat: 0 };
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, seat: 0 });
        io.to(roomId).emit('updateRoom', rooms[roomId]);
        
        io.to(roomId).emit('newChatMessage', {
            senderName: 'ระบบ',
            message: `🎉 คุณ ${playerName} สร้างห้องพักสำเร็จ`,
            isSystem: true
        });
    });

    socket.on('createSinglePlayer', (playerName) => {
        const roomId = Math.floor(1000 + Math.random() * 9000).toString();
        const room = createRoomObject(roomId);
        room.seats[0] = { id: socket.id, name: playerName, isAI: false, isAutoBot: false, seat: 0 };
        for (let i = 1; i <= 3; i++) {
            room.seats[i] = { id: `bot-${i}`, name: `บอท AI ${i}`, isAI: true, isAutoBot: false, seat: i };
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
        
        let emptySeat = room.seats.findIndex(s => s === null);
        if (emptySeat === -1) return socket.emit('errorMessage', 'ห้องเต็มแล้ว');

        room.seats[emptySeat] = { id: socket.id, name: playerName, isAI: false, isAutoBot: false, seat: emptySeat };
        socket.join(roomId);
        socket.emit('joinedSuccess', { roomId, seat: emptySeat });
        io.to(roomId).emit('updateRoom', room);

        io.to(roomId).emit('newChatMessage', {
            senderName: 'ระบบ',
            message: `👋 คุณ ${playerName} เข้าร่วมห้องแล้ว`,
            isSystem: true
        });
    });

    // ซิงก์ข้อมูลเมื่อหลุดสายหรือสลับแอพกลับมา
    socket.on('syncGameState', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room) return;
        socket.join(roomId);
        const player = room.seats.find(s => s && s.id === socket.id);
        if (player) {
            socket.emit('yourHand', room.hands[player.seat]);
        }
        socket.emit('updateGameState', room);
    });

    socket.on('toggleAutoBot', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.seats.find(s => s && s.id === socket.id);
        if (player) {
            player.isAutoBot = !player.isAutoBot;
            io.to(roomId).emit('updateGameState', room);
            
            io.to(roomId).emit('newChatMessage', {
                senderName: 'ระบบ',
                message: `🤖 คุณ ${player.name} ${player.isAutoBot ? 'เปิด' : 'ปิด'} โหมดบอทเล่นแทน`,
                isSystem: true
            });

            checkAITurn(room);
        }
    });

    socket.on('sendChatMessage', ({ roomId, message }) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.seats.find(s => s && s.id === socket.id);
        const senderName = player ? player.name : 'ผู้รับชม';

        io.to(roomId).emit('newChatMessage', {
            senderId: socket.id,
            senderName: senderName,
            message: message,
            isSystem: false
        });
    });

    socket.on('changeSeat', ({ roomId, targetSeat }) => {
        const room = rooms[roomId];
        if (!room || room.gameState !== 'LOBBY') return;
        
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
        if (!room || room.gameState !== 'LOBBY') return;
        for (let i = 0; i < 4; i++) {
            if (room.seats[i] === null) {
                room.seats[i] = { id: `bot-${i}`, name: `บอท AI ${i}`, isAI: true, isAutoBot: false, seat: i };
            }
        }
        io.to(roomId).emit('updateRoom', room);
    });

    socket.on('startGameReq', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room) return;
        if (room.seats.some(s => s === null)) return socket.emit('errorMessage', 'ที่นั่งยังไม่ครบ 4 คน');

        startNewGame(room);
    });

    socket.on('submitBid', ({ roomId, bidValue, isPass }) => {
        const room = rooms[roomId];
        if (!room || room.gameState !== 'BIDDING') return;

        processBid(room, bidValue, isPass);
    });

    socket.on('selectTrump', ({ roomId, suit }) => {
        const room = rooms[roomId];
        if (!room || room.gameState !== 'SELECT_TRUMP') return;
        
        processTrumpSelection(room, suit);
    });

    socket.on('confirmDiscard', ({ roomId, discardIndexes }) => {
        const room = rooms[roomId];
        if (!room || room.gameState !== 'KITTY_DISCARD') return;

        processDiscard(room, discardIndexes);
    });

    socket.on('playCard', ({ roomId, cardIndex }) => {
        const room = rooms[roomId];
        if (!room || room.gameState !== 'PLAYING') return;

        let currentTurn = getCurrentTurn(room);
        let playerSocket = room.seats[currentTurn];

        if (playerSocket.id !== socket.id) return;

        // หากผู้เล่นลงไพ่เอง ให้ปิดโหมด AutoBot ทันที
        if (playerSocket.isAutoBot) {
            playerSocket.isAutoBot = false;
        }

        executePlayCard(room, currentTurn, cardIndex);
    });

    socket.on('restartGameReq', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room) return;
        startNewGame(room);
    });
});

function startNewGame(room) {
    if (room.timerInterval) clearInterval(room.timerInterval);
    
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
        const player = room.seats[i];
        if (player && !player.isAI) {
            io.to(player.id).emit('yourHand', room.hands[i]);
        }
    }

    io.to(room.id).emit('updateGameState', room);
    startTurnTimer(room);
}

function getCurrentTurn(room) {
    let playedCount = room.currentRoundCards.filter(c => c !== null).length;
    return (room.starterPlayer + playedCount) % 4;
}

// -------------------------------------------------------------
// ระบบตัวจับเวลา 15 วินาที
// -------------------------------------------------------------
function startTurnTimer(room) {
    if (room.timerInterval) clearInterval(room.timerInterval);
    room.timeLeft = 15;

    let activeSeat = -1;
    if (room.gameState === 'BIDDING') activeSeat = room.bidTurn;
    else if (room.gameState === 'SELECT_TRUMP' || room.gameState === 'KITTY_DISCARD') activeSeat = room.dealer;
    else if (room.gameState === 'PLAYING') activeSeat = getCurrentTurn(room);

    if (activeSeat === -1) return;

    let activePlayer = room.seats[activeSeat];

    // หากเป็น บอท AI หรือ เปิดโหมด AutoBot อยู่แล้ว ให้เล่นทันทีใน 1 วิ
    if (activePlayer.isAI || activePlayer.isAutoBot) {
        io.to(room.id).emit('timerTick', { timeLeft: -1, currentTurn: activeSeat });
        setTimeout(() => checkAITurn(room), 1000);
        return;
    }

    // เริ่มนับถอยหลังสำหรับคนเล่นปกติ
    io.to(room.id).emit('timerTick', { timeLeft: room.timeLeft, currentTurn: activeSeat });

    room.timerInterval = setInterval(() => {
        room.timeLeft--;
        io.to(room.id).emit('timerTick', { timeLeft: room.timeLeft, currentTurn: activeSeat });

        if (room.timeLeft <= 0) {
            clearInterval(room.timerInterval);
            // หมดเวลา 15 วิ สลับผู้เล่นคนนี้เป็นโหมดบอทเล่นแทน
            activePlayer.isAutoBot = true;
            
            io.to(room.id).emit('newChatMessage', {
                senderName: 'ระบบ',
                message: `⏳ คุณ ${activePlayer.name} ไม่ได้ออกไพ่ใน 15 วิ ระบบจึงให้บอทเล่นแทน`,
                isSystem: true
            });

            io.to(room.id).emit('updateGameState', room);
            checkAITurn(room);
        }
    }, 1000);
}

function processBid(room, bidValue, isPass) {
    if (room.timerInterval) clearInterval(room.timerInterval);

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
        startTurnTimer(room);
        return;
    }

    room.bidTurn = (room.bidTurn + 1) % 4;
    io.to(room.id).emit('updateGameState', room);
    startTurnTimer(room);
}

function processTrumpSelection(room, suit) {
    if (room.timerInterval) clearInterval(room.timerInterval);

    room.trumpSuit = suit;
    room.hands[room.dealer].push(...room.kitty);
    room.hands[room.dealer].sort(sortCards);
    room.kitty = [];

    const dealerSocket = io.sockets.sockets.get(room.seats[room.dealer].id);
    if (dealerSocket) dealerSocket.emit('yourHand', room.hands[room.dealer]);

    room.gameState = 'KITTY_DISCARD';
    io.to(room.id).emit('updateGameState', room);
    startTurnTimer(room);
}

function processDiscard(room, discardIndexes) {
    if (room.timerInterval) clearInterval(room.timerInterval);

    let dealerHand = room.hands[room.dealer];
    discardIndexes.sort((a, b) => b - a);
    discardIndexes.forEach(idx => {
        room.kitty.push(dealerHand.splice(idx, 1)[0]);
    });

    dealerHand.sort(sortCards);

    const dealerSocket = io.sockets.sockets.get(room.seats[room.dealer].id);
    if (dealerSocket) dealerSocket.emit('yourHand', dealerHand);

    room.gameState = 'PLAYING';
    room.starterPlayer = room.dealer;
    io.to(room.id).emit('updateGameState', room);
    startTurnTimer(room);
}

function executePlayCard(room, seatIndex, cardIndex) {
    if (room.timerInterval) clearInterval(room.timerInterval);

    let hand = room.hands[seatIndex];
    let card = hand[cardIndex];

    let playedCount = room.currentRoundCards.filter(c => c !== null).length;
    if (playedCount > 0) {
        let leadCard = room.currentRoundCards[room.starterPlayer];
        let hasLeadSuit = hand.some(c => c.suit === leadCard.suit);
        if (hasLeadSuit && card.suit !== leadCard.suit) {
            startTurnTimer(room);
            return;
        }
        if (!hasLeadSuit && !room.voidSuits[seatIndex].includes(leadCard.suit)) {
            room.voidSuits[seatIndex].push(leadCard.suit);
        }
    }

    hand.splice(cardIndex, 1);
    room.currentRoundCards[seatIndex] = card;

    const player = room.seats[seatIndex];
    if (player && !player.isAI) {
        io.to(player.id).emit('yourHand', hand);
    }

    if (room.currentRoundCards.filter(c => c !== null).length === 4) {
        io.to(room.id).emit('updateGameState', room);
        setTimeout(() => resolveRound(room), 1500);
    } else {
        io.to(room.id).emit('updateGameState', room);
        startTurnTimer(room);
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
    if (room.gameState !== 'END') {
        startTurnTimer(room);
    }
}

// -------------------------------------------------------------
// AI Logic & AutoBot Handler
// -------------------------------------------------------------
function checkAITurn(room) {
    if (room.gameState === 'BIDDING') {
        let currentBot = room.seats[room.bidTurn];
        if (currentBot && (currentBot.isAI || currentBot.isAutoBot)) {
            let bidValue = 0;
            let isPass = true;
            if (room.highestBid < 70 && Math.random() > 0.5) {
                bidValue = room.highestBid + 5;
                isPass = false;
            }
            processBid(room, bidValue, isPass);
        }
    } else if (room.gameState === 'SELECT_TRUMP') {
        let dealerBot = room.seats[room.dealer];
        if (dealerBot && (dealerBot.isAI || dealerBot.isAutoBot)) {
            const suits = ['♠', '♥️', '♣', '♦️'];
            let chosenSuit = suits[Math.floor(Math.random() * suits.length)];
            processTrumpSelection(room, chosenSuit);
        }
    } else if (room.gameState === 'KITTY_DISCARD') {
        let dealerBot = room.seats[room.dealer];
        if (dealerBot && (dealerBot.isAI || dealerBot.isAutoBot)) {
            let hand = room.hands[room.dealer];
            let nonPointIndexes = [];
            hand.forEach((c, idx) => {
                if (!['A', '10', '5'].includes(c.value)) nonPointIndexes.push(idx);
            });
            nonPointIndexes.sort(() => Math.random() - 0.5);
            let toDiscard = nonPointIndexes.slice(0, 4);
            processDiscard(room, toDiscard);
        }
    } else if (room.gameState === 'PLAYING') {
        let currentTurn = getCurrentTurn(room);
        let bot = room.seats[currentTurn];
        if (bot && (bot.isAI || bot.isAutoBot)) {
            let chosenIndex = getSmartAICardIndex(room, currentTurn);
            executePlayCard(room, currentTurn, chosenIndex);
        }
    }
}

function getSmartAICardIndex(room, seatIndex) {
    let hand = room.hands[seatIndex];
    let playedCards = room.currentRoundCards;
    let starter = room.starterPlayer;
    let playedHistory = room.playedHistory || [];
    let trumpSuit = room.trumpSuit;
    let dealerSeat = room.dealer;

    let partnerSeat = (seatIndex + 2) % 4;
    let isPartnerDealer = (partnerSeat === dealerSeat);

    let playedCount = playedCards.filter(c => c !== null).length;
    let leadCard = playedCount > 0 ? playedCards[starter] : null;

    let validCards = [];
    if (leadCard) {
        validCards = hand.map((card, idx) => ({ card, idx })).filter(item => item.card.suit === leadCard.suit);
    }
    if (validCards.length === 0) {
        validCards = hand.map((card, idx) => ({ card, idx }));
    }

    const isHighestRemainingInSuit = (card) => {
        let ranks = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
        for (let r of ranks) {
            if (CARD_RANKS[r] > CARD_RANKS[card.value]) {
                let played = playedHistory.some(c => c.suit === card.suit && c.value === r);
                let inHand = hand.some(c => c.suit === card.suit && c.value === r);
                if (!played && !inHand) return false;
            } else if (r === card.value) break;
        }
        return true;
    };

    const getWinningSeatSoFar = () => {
        let winSeat = starter;
        let winCard = playedCards[starter];
        for (let i = 0; i < 4; i++) {
            let card = playedCards[i];
            if (!card || i === starter) continue;
            if (card.suit === winCard.suit && CARD_RANKS[card.value] > CARD_RANKS[winCard.value]) {
                winCard = card;
                winSeat = i;
            } else if (card.suit === trumpSuit && winCard.suit !== trumpSuit) {
                winCard = card;
                winSeat = i;
            }
        }
        return winSeat;
    };

    const isCardBigger = (cardA, cardB) => {
        if (!cardB) return true;
        if (cardA.suit === cardB.suit) return CARD_RANKS[cardA.value] > CARD_RANKS[cardB.value];
        if (cardA.suit === trumpSuit && cardB.suit !== trumpSuit) return true;
        return false;
    };

    let pointCards = validCards.filter(item => ['A', '10', '5'].includes(item.card.value));
    let nonPointCards = validCards.filter(item => !['A', '10', '5'].includes(item.card.value));

    if (playedCount === 0) {
        let aces = validCards.filter(item => item.card.value === 'A');
        if (aces.length > 0) return aces[0].idx;
        if (nonPointCards.length > 0) return nonPointCards[0].idx;
        return validCards[0].idx;
    }

    if (playedCount === 1) {
        let p1Card = playedCards[starter];
        let winningChoices = validCards.filter(item => isCardBigger(item.card, p1Card));
        if (winningChoices.length > 0) {
            winningChoices.sort((a, b) => CARD_RANKS[b.card.value] - CARD_RANKS[a.card.value]);
            return winningChoices[0].idx;
        }
        if (nonPointCards.length > 0) return nonPointCards[0].idx;
        return validCards[0].idx;
    }

    if (playedCount === 2 || playedCount === 3) {
        let currentWinnerSeat = getWinningSeatSoFar();
        let isPartnerWinning = (currentWinnerSeat === partnerSeat);

        if (isPartnerWinning && pointCards.length > 0) {
            pointCards.sort((a, b) => calculateCardScore(b.card) - calculateCardScore(a.card));
            return pointCards[0].idx;
        }

        let currentBest = playedCards[currentWinnerSeat];
        let winningChoices = validCards.filter(item => isCardBigger(item.card, currentBest));

        if (winningChoices.length > 0) {
            winningChoices.sort((a, b) => CARD_RANKS[b.card.value] - CARD_RANKS[a.card.value]);
            return winningChoices[0].idx;
        } else {
            if (nonPointCards.length > 0) return nonPointCards[0].idx;
            return validCards[0].idx;
        }
    }

    return 0;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
