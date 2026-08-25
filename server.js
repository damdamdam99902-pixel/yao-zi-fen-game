const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// 🧠 AI BRAIN & MEMORY SYSTEM
// ==========================================

const CARD_RANK_VALUES = {
    'A': 14, 'K': 13, 'Q': 12, 'J': 11, '10': 10,
    '9': 9, '8': 8, '7': 7, '6': 6, '5': 5,
    '4': 4, '3': 3, '2': 2
};

function recordCardPlayed(room, seat, card) {
    if (!room.playedCardsHistory) room.playedCardsHistory = [];
    if (!room.voidSuits) room.voidSuits = {};

    room.playedCardsHistory.push(card);

    const leadCard = room.currentRoundCards[room.starterPlayer];
    if (leadCard && card.suit !== leadCard.suit) {
        if (!room.voidSuits[seat]) room.voidSuits[seat] = [];
        if (!room.voidSuits[seat].includes(leadCard.suit)) {
            room.voidSuits[seat].push(leadCard.suit);
        }
    }
}

function getSmartAIBestCard(room, botSeat) {
    const hand = room.seats[botSeat].hand;
    const currentRoundCards = room.currentRoundCards;
    const playedCardsHistory = room.playedCardsHistory || [];
    const voidSuits = room.voidSuits || {};
    
    const trumpSuit = room.trumpSuit;
    const dealerSeat = room.dealer;
    const isDealerTeam = (botSeat === dealerSeat || (botSeat + 2) % 4 === dealerSeat);
    const partnerSeat = (botSeat + 2) % 4;
    
    const playedSeats = [];
    currentRoundCards.forEach((card, seat) => {
        if (card !== null) playedSeats.push(seat);
    });
    const turnIndex = playedSeats.length + 1;
    const leadCard = playedSeats.length > 0 ? currentRoundCards[room.starterPlayer] : null;
    const leadSuit = leadCard ? leadCard.suit : null;

    let validCards = [];
    if (leadSuit) {
        validCards = hand.filter(c => c.suit === leadSuit);
        if (validCards.length === 0) validCards = [...hand];
    } else {
        validCards = [...hand];
    }

    const isPointCard = (card) => ['10', '5'].includes(card.value);
    const isAce = (card) => card.value === 'A';
    const isTrump = (card) => card.suit === trumpSuit;
    const getPower = (card, lSuit) => {
        let power = CARD_RANK_VALUES[card.value];
        if (card.suit === trumpSuit) power += 100;
        else if (lSuit && card.suit !== lSuit) power = 0;
        return power;
    };

    const isHighestRemainingInSuit = (card) => {
        const suit = card.suit;
        const higherValues = Object.keys(CARD_RANK_VALUES).filter(val => CARD_RANK_VALUES[val] > CARD_RANK_VALUES[card.value]);
        
        return higherValues.every(val => {
            return playedCardsHistory.some(c => c.suit === suit && c.value === val);
        });
    };

    const getHighestCardOnTableInfo = () => {
        let maxPower = -1;
        let winningSeat = -1;
        let winningCard = null;

        playedSeats.forEach(seat => {
            const card = currentRoundCards[seat];
            const power = getPower(card, leadSuit);
            if (power > maxPower) {
                maxPower = power;
                winningSeat = seat;
                winningCard = card;
            }
        });
        return { winningSeat, winningCard, maxPower };
    };

    // --- Turn 1 ---
    if (turnIndex === 1) {
        const aces = validCards.filter(c => isAce(c));
        const safeAces = aces.filter(c => {
            const opponentSeats = [ (botSeat + 1) % 4, (botSeat + 3) % 4 ];
            const isOpponentDealerNoSuit = opponentSeats.some(op => op === dealerSeat && (voidSuits[op] || []).includes(c.suit));
            return !isOpponentDealerNoSuit;
        });

        if (safeAces.length > 0) return safeAces[0];

        if (isDealerTeam) {
            if (aces.length > 0) return aces[0];

            const option = Math.random() < 0.5 ? 1 : 2;
            if (option === 1) {
                const smallTrumps = validCards.filter(c => isTrump(c) && !isPointCard(c))
                    .sort((a,b) => CARD_RANK_VALUES[a.value] - CARD_RANK_VALUES[b.value]);
                if (smallTrumps.length > 0) return smallTrumps[0];
            }
            
            const bigNonTrumps = validCards.filter(c => !isTrump(c) && !isPointCard(c))
                .sort((a,b) => CARD_RANK_VALUES[b.value] - CARD_RANK_VALUES[a.value]);
            if (bigNonTrumps.length > 0) return bigNonTrumps[0];

            const fives = validCards.filter(c => c.value === '5');
            if (fives.length > 0) return fives[0];
            const tens = validCards.filter(c => c.value === '10');
            if (tens.length > 0) return tens[0];
        } else {
            if (aces.length > 0) return aces[0];

            const safeBigCards = validCards.filter(c => {
                const isDealerVoid = (voidSuits[dealerSeat] || []).includes(c.suit);
                return !isPointCard(c) && !isDealerVoid;
            }).sort((a,b) => CARD_RANK_VALUES[b.value] - CARD_RANK_VALUES[a.value]);

            if (safeBigCards.length > 0) return safeBigCards[0];
        }

        const defaultCards = validCards.filter(c => !isPointCard(c))
            .sort((a,b) => CARD_RANK_VALUES[a.value] - CARD_RANK_VALUES[b.value]);
        return defaultCards.length > 0 ? defaultCards[0] : validCards[0];
    }

    // --- Turn 2 ---
    if (turnIndex === 2) {
        const firstCard = currentRoundCards[room.starterPlayer];
        const firstPower = getPower(firstCard, leadSuit);

        const winningCardsNoPoints = validCards.filter(c => getPower(c, leadSuit) > firstPower && !isPointCard(c))
            .sort((a,b) => getPower(b, leadSuit) - getPower(a, leadSuit));
        if (winningCardsNoPoints.length > 0) return winningCardsNoPoints[0];

        const winningCardsPoints = validCards.filter(c => getPower(c, leadSuit) > firstPower)
            .sort((a,b) => getPower(b, leadSuit) - getPower(a, leadSuit));
        if (winningCardsPoints.length > 0) return winningCardsPoints[0];

        const smallestNoPoints = validCards.filter(c => !isPointCard(c))
            .sort((a,b) => CARD_RANK_VALUES[a.value] - CARD_RANK_VALUES[b.value]);
        if (smallestNoPoints.length > 0) return smallestNoPoints[0];

        return validCards.sort((a,b) => CARD_RANK_VALUES[a.value] - CARD_RANK_VALUES[b.value])[0];
    }

    // --- Turn 3 ---
    if (turnIndex === 3) {
        const p1Card = currentRoundCards[room.starterPlayer];
        const tableInfo = getHighestCardOnTableInfo();
        const isPartnerP1 = (partnerSeat === room.starterPlayer);
        const isP1HighestInGame = isHighestRemainingInSuit(p1Card);

        if (isPartnerP1 && (tableInfo.winningSeat === partnerSeat) && isP1HighestInGame) {
            const pointCards = validCards.filter(c => isPointCard(c))
                .sort((a,b) => CARD_RANK_VALUES[b.value] - CARD_RANK_VALUES[a.value]);
            if (pointCards.length > 0) return pointCards[0];
        }

        if (tableInfo.winningSeat !== partnerSeat) {
            if (!validCards.some(c => c.suit === leadSuit)) {
                const trumpCards = validCards.filter(c => isTrump(c) && getPower(c, leadSuit) > tableInfo.maxPower)
                    .sort((a,b) => CARD_RANK_VALUES[a.value] - CARD_RANK_VALUES[b.value]);
                if (trumpCards.length > 0) return trumpCards[0];
            }
        }

        const winningCards = validCards.filter(c => getPower(c, leadSuit) > tableInfo.maxPower && !isPointCard(c))
            .sort((a,b) => getPower(b, leadSuit) - getPower(a, leadSuit));
        if (winningCards.length > 0) return winningCards[0];

        const smallestNoPoints = validCards.filter(c => !isPointCard(c))
            .sort((a,b) => CARD_RANK_VALUES[a.value] - CARD_RANK_VALUES[b.value]);
        if (smallestNoPoints.length > 0) return smallestNoPoints[0];

        return validCards.sort((a,b) => CARD_RANK_VALUES[a.value] - CARD_RANK_VALUES[b.value])[0];
    }

    // --- Turn 4 ---
    if (turnIndex === 4) {
        const tableInfo = getHighestCardOnTableInfo();
        const isPartnerWinning = (tableInfo.winningSeat === partnerSeat);
        const partnerCard = currentRoundCards[partnerSeat];
        const isPartnerCardHighestInGame = partnerCard ? isHighestRemainingInSuit(partnerCard) : false;

        if (isPartnerWinning || isPartnerCardHighestInGame) {
            const pointCards = validCards.filter(c => isPointCard(c))
                .sort((a,b) => CARD_RANK_VALUES[b.value] - CARD_RANK_VALUES[a.value]);
            if (pointCards.length > 0) return pointCards[0];
        }

        const winningCardsNoPoints = validCards.filter(c => getPower(c, leadSuit) > tableInfo.maxPower && !isPointCard(c))
            .sort((a,b) => getPower(b, leadSuit) - getPower(a, leadSuit));
        if (winningCardsNoPoints.length > 0) return winningCardsNoPoints[0];

        const winningCards = validCards.filter(c => getPower(c, leadSuit) > tableInfo.maxPower)
            .sort((a,b) => getPower(b, leadSuit) - getPower(a, leadSuit));
        if (winningCards.length > 0) return winningCards[0];

        const smallestNoPoints = validCards.filter(c => !isPointCard(c))
            .sort((a,b) => CARD_RANK_VALUES[a.value] - CARD_RANK_VALUES[b.value]);
        if (smallestNoPoints.length > 0) return smallestNoPoints[0];

        return validCards.sort((a,b) => CARD_RANK_VALUES[a.value] - CARD_RANK_VALUES[b.value])[0];
    }

    return validCards[0];
}

// ==========================================
// 🃏 GAME ENGINE & ROOM MANAGEMENT
// ==========================================

const rooms = {};

function createDeck() {
    const suits = ['♠', '♥️', '♣', '♦️'];
    const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    const deck = [];
    for (let s of suits) {
        for (let v of values) {
            deck.push({ suit: s, value: v });
        }
    }
    return deck.sort(() => Math.random() - 0.5);
}

function calculateCardPoints(cards) {
    let score = 0;
    cards.forEach(c => {
        if (c.value === '5') score += 5;
        if (c.value === '10' || c.value === 'K') score += 10;
    });
    return score;
}

function processTurn(room) {
    if (room.gameState === 'BIDDING') {
        const currentBot = room.seats[room.bidTurn];
        if (currentBot && currentBot.isAI) {
            setTimeout(() => {
                // บอทสุ่มประมูลหรือผ่านตามจังหวะ
                if (room.highestBid < 75 && Math.random() > 0.4) {
                    const nextBid = room.highestBid === 60 ? 65 : room.highestBid + 5;
                    room.highestBid = nextBid;
                    room.dealer = room.bidTurn;
                    io.to(room.id).emit('newChatMessage', { isSystem: true, message: `🤖 ${currentBot.name} สู้ประมูลที่ ${nextBid}` });
                } else {
                    io.to(room.id).emit('newChatMessage', { isSystem: true, message: `🤖 ${currentBot.name} หมอบ` });
                }

                let nextTurn = (room.bidTurn + 1) % 4;
                let activeBidders = room.seats.filter(s => s !== null);
                
                // สลับตาประมูล
                room.bidTurn = nextTurn;
                
                // ตรวจสอบจบช่วงประมูล
                if (room.highestBid > 60 && Math.random() > 0.6) {
                    room.gameState = 'SELECT_TRUMP';
                    io.emit('updateGameState', room);
                    processTurn(room);
                    return;
                }
                
                io.emit('updateGameState', room);
                processTurn(room);
            }, 1000);
        }
    } else if (room.gameState === 'SELECT_TRUMP') {
        const dealerBot = room.seats[room.dealer];
        if (dealerBot && dealerBot.isAI) {
            setTimeout(() => {
                const suits = ['♠', '♥️', '♣', '♦️'];
                room.trumpSuit = suits[Math.floor(Math.random() * suits.length)];
                
                // แจกไพ่กลาง 4 ใบให้ผู้ชนะประมูล
                dealerBot.hand.push(...room.kitty);
                room.kitty = [];
                
                room.gameState = 'KITTY_DISCARD';
                io.emit('updateGameState', room);
                io.to(dealerBot.id).emit('yourHand', dealerBot.hand);
                processTurn(room);
            }, 1000);
        }
    } else if (room.gameState === 'KITTY_DISCARD') {
        const dealerBot = room.seats[room.dealer];
        if (dealerBot && dealerBot.isAI) {
            setTimeout(() => {
                // เลือกฝังไพ่ที่ไม่ใช่ 5, 10, A
                const safeCards = dealerBot.hand.filter(c => !['5', '10', 'A'].includes(c.value));
                const discardIndexes = [];
                
                for (let i = 0; i < dealerBot.hand.length && discardIndexes.length < 4; i++) {
                    if (!['5', '10', 'A'].includes(dealerBot.hand[i].value)) {
                        discardIndexes.push(i);
                    }
                }

                // ดึงไพ่ออกจากมือบอท
                discardIndexes.sort((a,b) => b - a).forEach(idx => {
                    dealerBot.hand.splice(idx, 1);
                });

                room.gameState = 'PLAYING';
                room.starterPlayer = room.dealer;
                io.emit('updateGameState', room);
                processTurn(room);
            }, 1000);
        }
    } else if (room.gameState === 'PLAYING') {
        let playedCount = room.currentRoundCards.filter(c => c !== null).length;
        if (playedCount === 4) {
            // จบรอบ 4 ใบ คำนวณหาผู้ชนะรอบนี้
            setTimeout(() => {
                const leadCard = room.currentRoundCards[room.starterPlayer];
                let winnerSeat = room.starterPlayer;
                let maxPower = -1;

                room.currentRoundCards.forEach((card, seat) => {
                    let power = CARD_RANK_VALUES[card.value];
                    if (card.suit === room.trumpSuit) power += 100;
                    else if (card.suit !== leadCard.suit) power = 0;

                    if (power > maxPower) {
                        maxPower = power;
                        winnerSeat = seat;
                    }
                });

                // ย้ายไพ่สะสมแต้มเข้าทีมผู้ชนะ
                const roundPointsCards = room.currentRoundCards.filter(c => ['5', '10', 'K'].includes(c.value));
                if (winnerSeat === 0 || winnerSeat === 2) {
                    room.teamACapturedCards.push(...roundPointsCards);
                    room.teamAScore += calculateCardPoints(roundPointsCards);
                } else {
                    room.teamBCapturedCards.push(...roundPointsCards);
                    room.teamBScore += calculateCardPoints(roundPointsCards);
                }

                room.currentRoundCards = [null, null, null, null];
                room.starterPlayer = winnerSeat;

                // เช็คว่าไพ่หมดมือจบเกมหรือยัง
                if (room.seats[0].hand.length === 0) {
                    room.gameState = 'END';
                }

                io.emit('updateGameState', room);
                processTurn(room);
            }, 1500);
            return;
        }

        let currentTurn = (room.starterPlayer + playedCount) % 4;
        let currentBot = room.seats[currentTurn];

        if (currentBot && currentBot.isAI) {
            setTimeout(() => {
                const bestCard = getSmartAIBestCard(room, currentTurn);
                const cardIndex = currentBot.hand.findIndex(c => c.suit === bestCard.suit && c.value === bestCard.value);
                
                const playedCard = currentBot.hand.splice(cardIndex, 1)[0];
                room.currentRoundCards[currentTurn] = playedCard;

                // บันทึกความจำ AI
                recordCardPlayed(room, currentTurn, playedCard);

                io.emit('updateGameState', room);
                processTurn(room);
            }, 1000);
        }
    }
}

// ==========================================
// 🔌 SOCKET.IO EVENTS
// ==========================================

io.on('connection', (socket) => {

    socket.on('createSinglePlayer', (playerName) => {
        const roomId = Math.floor(1000 + Math.random() * 9000).toString();
        const newRoom = {
            id: roomId,
            gameState: 'LOBBY',
            seats: [
                { id: socket.id, name: playerName, seat: 0, isAI: false, hand: [] },
                { id: 'bot_1', name: '🤖 บอทสมชาย', seat: 1, isAI: true, hand: [] },
                { id: 'bot_2', name: '🤖 บอทสมหญิง', seat: 2, isAI: true, hand: [] },
                { id: 'bot_3', name: '🤖 บอทสมศักดิ์', seat: 3, isAI: true, hand: [] }
            ],
            bidTurn: 0,
            highestBid: 60,
            dealer: 0,
            trumpSuit: null,
            kitty: [],
            currentRoundCards: [null, null, null, null],
            starterPlayer: 0,
            teamAScore: 0,
            teamBScore: 0,
            teamACapturedCards: [],
            teamBCapturedCards: [],
            playedCardsHistory: [],
            voidSuits: {}
        };

        rooms[roomId] = newRoom;
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, seat: 0 });
        io.to(roomId).emit('updateRoom', newRoom);
    });

    socket.on('createRoom', (playerName) => {
        const roomId = Math.floor(1000 + Math.random() * 9000).toString();
        const newRoom = {
            id: roomId,
            gameState: 'LOBBY',
            seats: [
                { id: socket.id, name: playerName, seat: 0, isAI: false, hand: [] },
                null, null, null
            ],
            bidTurn: 0,
            highestBid: 60,
            dealer: 0,
            trumpSuit: null,
            kitty: [],
            currentRoundCards: [null, null, null, null],
            starterPlayer: 0,
            teamAScore: 0,
            teamBScore: 0,
            teamACapturedCards: [],
            teamBCapturedCards: [],
            playedCardsHistory: [],
            voidSuits: {}
        };

        rooms[roomId] = newRoom;
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, seat: 0 });
        io.to(roomId).emit('updateRoom', newRoom);
    });

    socket.on('joinRoom', ({ roomId, playerName }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('errorMessage', 'ไม่พบห้องนี้');

        const emptySeatIndex = room.seats.findIndex(s => s === null);
        if (emptySeatIndex === -1) return socket.emit('errorMessage', 'ห้องเต็มแล้ว');

        room.seats[emptySeatIndex] = { id: socket.id, name: playerName, seat: emptySeatIndex, isAI: false, hand: [] };
        socket.join(roomId);
        socket.emit('joinedSuccess', { roomId, seat: emptySeatIndex });
        io.to(roomId).emit('updateRoom', room);
    });

    socket.on('fillAI', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room) return;
        
        const botNames = ['🤖 บอทสมชาย', '🤖 บอทสมหญิง', '🤖 บอทสมศักดิ์'];
        let botIdx = 0;

        for (let i = 0; i < 4; i++) {
            if (room.seats[i] === null) {
                room.seats[i] = {
                    id: `bot_${i}_${Date.now()}`,
                    name: botNames[botIdx++ % botNames.length],
                    seat: i,
                    isAI: true,
                    hand: []
                };
            }
        }
        io.to(roomId).emit('updateRoom', room);
    });

    socket.on('startGameReq', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room) return;

        const deck = createDeck();
        room.seats.forEach(p => {
            if (p) p.hand = deck.splice(0, 12);
        });
        room.kitty = deck.splice(0, 4);

        room.gameState = 'BIDDING';
        room.highestBid = 60;
        room.bidTurn = 0;
        room.teamAScore = 0;
        room.teamBScore = 0;
        room.teamACapturedCards = [];
        room.teamBCapturedCards = [];
        room.playedCardsHistory = [];
        room.voidSuits = {};

        // ส่งไพ่ให้ผู้เล่นมนุษย์ทุกคน
        room.seats.forEach(p => {
            if (p && !p.isAI) {
                io.to(p.id).emit('yourHand', p.hand);
            }
        });

        io.to(roomId).emit('updateGameState', room);
        processTurn(room);
    });

    socket.on('submitBid', ({ roomId, bidValue, isPass }) => {
        const room = rooms[roomId];
        if (!room) return;

        const player = room.seats.find(s => s && s.id === socket.id);
        if (!player || player.seat !== room.bidTurn) return;

        if (!isPass && bidValue > room.highestBid) {
            room.highestBid = bidValue;
            room.dealer = player.seat;
            io.to(roomId).emit('newChatMessage', { isSystem: true, message: `💬 ${player.name} สู้ประมูลที่ ${bidValue}` });
        } else {
            io.to(roomId).emit('newChatMessage', { isSystem: true, message: `💬 ${player.name} หมอบ` });
        }

        room.bidTurn = (room.bidTurn + 1) % 4;

        if (room.highestBid > 60 && Math.random() > 0.5) {
            room.gameState = 'SELECT_TRUMP';
        }

        io.to(roomId).emit('updateGameState', room);
        processTurn(room);
    });

    socket.on('selectTrump', ({ roomId, suit }) => {
        const room = rooms[roomId];
        if (!room) return;

        room.trumpSuit = suit;
        const dealerPlayer = room.seats[room.dealer];
        
        dealerPlayer.hand.push(...room.kitty);
        room.kitty = [];

        room.gameState = 'KITTY_DISCARD';
        io.to(dealerPlayer.id).emit('yourHand', dealerPlayer.hand);
        io.to(roomId).emit('updateGameState', room);
        processTurn(room);
    });

    socket.on('confirmDiscard', ({ roomId, discardIndexes }) => {
        const room = rooms[roomId];
        if (!room) return;

        const dealerPlayer = room.seats[room.dealer];
        discardIndexes.sort((a,b) => b - a).forEach(idx => {
            dealerPlayer.hand.splice(idx, 1);
        });

        io.to(dealerPlayer.id).emit('yourHand', dealerPlayer.hand);
        
        room.gameState = 'PLAYING';
        room.starterPlayer = room.dealer;

        io.to(roomId).emit('updateGameState', room);
        processTurn(room);
    });

    socket.on('playCard', ({ roomId, cardIndex }) => {
        const room = rooms[roomId];
        if (!room) return;

        const player = room.seats.find(s => s && s.id === socket.id);
        if (!player) return;

        let playedCount = room.currentRoundCards.filter(c => c !== null).length;
        let currentTurn = (room.starterPlayer + playedCount) % 4;

        if (player.seat !== currentTurn) return;

        const playedCard = player.hand.splice(cardIndex, 1)[0];
        room.currentRoundCards[currentTurn] = playedCard;

        // บันทึกความจำเกม
        recordCardPlayed(room, currentTurn, playedCard);

        socket.emit('yourHand', player.hand);
        io.to(roomId).emit('updateGameState', room);
        processTurn(room);
    });

    socket.on('sendChatMessage', ({ roomId, message }) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.seats.find(s => s && s.id === socket.id);
        if (player) {
            io.to(roomId).emit('newChatMessage', {
                senderId: socket.id,
                senderName: player.name,
                message: message,
                isSystem: false
            });
        }
    });

    socket.on('restartGameReq', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room) return;
        
        // รีเซ็ตเกมเพื่อเล่นรอบใหม่
        const deck = createDeck();
        room.seats.forEach(p => {
            if (p) p.hand = deck.splice(0, 12);
        });
        room.kitty = deck.splice(0, 4);

        room.gameState = 'BIDDING';
        room.highestBid = 60;
        room.bidTurn = 0;
        room.teamAScore = 0;
        room.teamBScore = 0;
        room.teamACapturedCards = [];
        room.teamBCapturedCards = [];
        room.playedCardsHistory = [];
        room.voidSuits = {};

        room.seats.forEach(p => {
            if (p && !p.isAI) {
                io.to(p.id).emit('yourHand', p.hand);
            }
        });

        io.to(roomId).emit('updateGameState', room);
        processTurn(room);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
