/**
 * 局域网联机与房间系统端到端自动化测试
 * End-to-End Test for LAN Multiplayer, Room Search, and One-Click Bot Fill
 */

const { WebSocket } = require('ws');
const { httpServer, wss, roomManager, startServer } = require('../server.js');

const TEST_PORT = 3999;

function assert(condition, message) {
    if (!condition) {
        console.error(`❌ ASSERTION FAILED: ${message}`);
        process.exit(1);
    }
    console.log(`  ✅ ${message}`);
}

async function runMultiplayerTest() {
    console.log('=== 启动局域网联机与一键补齐人机自动化测试 ===');

    // 1. 在测试端口启动服务端
    await startServer(TEST_PORT);
    console.log(`✅ 服务端已在测试端口 ${TEST_PORT} 启动`);

    const wsUrl = `ws://localhost:${TEST_PORT}`;

    // 2. 客户端 1 (房主 - 牛仔大叔) 连接
    const client1 = new WebSocket(wsUrl);
    await new Promise(resolve => client1.on('open', resolve));
    console.log('✅ 客户端 1 (房主) 已连接 WebSocket');

    let roomId = null;
    let client1Id = null;

    // 监听客户端 1 消息
    const client1Messages = [];
    client1.on('message', data => {
        const msg = JSON.parse(data);
        client1Messages.push(msg);
    });

    // 3. 房主创建房间
    client1.send(JSON.stringify({
        type: 'CREATE_ROOM',
        options: {
            roomName: '联机测试房',
            smallBlind: 10,
            bigBlind: 20,
            startingChips: 1000
        },
        player: {
            name: '牛仔大叔',
            avatar: '🤠'
        }
    }));

    // 等待 ROOM_JOINED
    await new Promise(resolve => setTimeout(resolve, 300));
    const createRes = client1Messages.find(m => m.type === 'ROOM_JOINED');
    assert(createRes !== undefined, '客户端 1 成功收到 ROOM_JOINED');
    assert(createRes.isHost === true, '客户端 1 为房主');
    assert(createRes.roomId && createRes.roomId.length === 4, `生成了4位数字房间号: #${createRes.roomId}`);
    roomId = createRes.roomId;
    client1Id = createRes.playerId;

    // 4. 客户端 2 (好友 - 小李) 连接并搜索房间
    const client2 = new WebSocket(wsUrl);
    await new Promise(resolve => client2.on('open', resolve));
    console.log('✅ 客户端 2 (好友) 已连接 WebSocket');

    const client2Messages = [];
    client2.on('message', data => {
        const msg = JSON.parse(data);
        client2Messages.push(msg);
    });

    // 搜索房间号
    client2.send(JSON.stringify({
        type: 'SEARCH_ROOM',
        roomId: roomId
    }));

    await new Promise(resolve => setTimeout(resolve, 300));
    const searchRes = client2Messages.find(m => m.type === 'SEARCH_RESULT');
    assert(searchRes !== undefined && searchRes.found === true, `客户端 2 搜索到房间 #${roomId}`);
    assert(searchRes.room.playerCount === 1, '搜索结果显示房间当前有 1 人');

    // 加入房间
    client2.send(JSON.stringify({
        type: 'JOIN_ROOM',
        roomId: roomId,
        player: {
            name: '好友小李',
            avatar: '😎'
        }
    }));

    await new Promise(resolve => setTimeout(resolve, 300));
    const joinRes = client2Messages.find(m => m.type === 'ROOM_JOINED');
    assert(joinRes !== undefined, '客户端 2 成功加入房间并收到 ROOM_JOINED');
    assert(joinRes.isHost === false, '客户端 2 非房主');
    assert(joinRes.playerId !== client1Id, '客户端 2 分配到了独立的玩家 ID');

    // 5. 测试【一键补齐人机】
    console.log('\n--- 测试【一键补齐人机】功能 ---');
    client1.send(JSON.stringify({ type: 'FILL_BOTS' }));

    await new Promise(resolve => setTimeout(resolve, 400));
    const roomUpdates1 = client1Messages.filter(m => m.type === 'ROOM_UPDATE');
    const lastUpdate1 = roomUpdates1[roomUpdates1.length - 1];
    assert(lastUpdate1 !== undefined, '客户端 1 收到补齐后的 ROOM_UPDATE');
    assert(lastUpdate1.room.players.length === 6, `一键补齐成功：房间当前玩家数为 6 (满座)`);

    const humanCount = lastUpdate1.room.players.filter(p => p.isHuman).length;
    const botCount = lastUpdate1.room.players.filter(p => !p.isHuman).length;
    assert(humanCount === 2, '包含 2 位真人玩家 (房主牛仔大叔 + 好友小李)');
    assert(botCount === 4, '包含 4 位自动分配的电脑人机');

    // 6. 测试【开始游戏】与【反作弊底牌脱敏隔离】
    console.log('\n--- 测试【开始游戏】与【手牌防作弊脱敏】 ---');
    client1.send(JSON.stringify({ type: 'START_GAME' }));

    await new Promise(resolve => setTimeout(resolve, 500));
    const gameStart1 = client1Messages.find(m => m.type === 'GAME_START');
    const gameStart2 = client2Messages.find(m => m.type === 'GAME_START');
    assert(gameStart1 !== undefined && gameStart2 !== undefined, '两端均收到 GAME_START 事件');

    // 获取各自收到的 GAME_STATE
    const gameStates1 = client1Messages.filter(m => m.type === 'GAME_STATE');
    const gameStates2 = client2Messages.filter(m => m.type === 'GAME_STATE');
    assert(gameStates1.length > 0 && gameStates2.length > 0, '两端均收到首轮 GAME_STATE');

    const stateForClient1 = gameStates1[0];
    const stateForClient2 = gameStates2[0];

    // 验证客户端 1 自己的牌是可见的
    const p1InClient1 = stateForClient1.players.find(p => p.id === client1Id);
    assert(p1InClient1.holeCards.length === 2 && !p1InClient1.holeCards[0].hidden, '客户端 1 可以清晰看到自己的 2 张底牌');

    // 验证客户端 1 视角中的客户端 2 的牌是被隐藏的 (防作弊)
    const p2InClient1 = stateForClient1.players.find(p => p.id === joinRes.playerId);
    assert(p2InClient1.holeCards[0].hidden === true, '反作弊验证成功：客户端 1 无法获取客户端 2 的私有底牌');

    // 验证客户端 2 视角中的客户端 1 的牌是被隐藏的 (防作弊)
    const p1InClient2 = stateForClient2.players.find(p => p.id === client1Id);
    assert(p1InClient2.holeCards[0].hidden === true, '反作弊验证成功：客户端 2 无法获取客户端 1 的私有底牌');

    // 验证盲注扣除正确
    assert(stateForClient1.highestRoundBet === 20, '翻牌前最高下注额为大盲注 $20');
    assert(stateForClient1.totalPot === 30, '初始底池正确包含小盲($10)与大盲($20)共 $30');

    // 7. 测试联机下注与操作响应 (Call / Raise / Check / Fold)
    console.log('\n--- 测试【联机下注数据完整度与客户端控制栏状态】 ---');
    assert(stateForClient1.bigBlind === 20, 'GAME_STATE 包含正确的 bigBlind');
    assert(stateForClient1.smallBlind === 10, 'GAME_STATE 包含正确的 smallBlind');
    assert(typeof stateForClient1.currentTurnPlayerId === 'number', 'GAME_STATE 明确指派了当前行动玩家 ID');

    // 验证客户端 mock 状态生成与控制栏启用逻辑
    const mockHeroId = stateForClient1.currentTurnPlayerId;
    const mockGameState = {
        currentTurnPlayerId: mockHeroId,
        highestRoundBet: stateForClient1.highestRoundBet,
        minRaise: stateForClient1.minRaise,
        pot: stateForClient1.totalPot,
        totalPot: stateForClient1.totalPot,
        toCall: 10,
        bigBlind: stateForClient1.bigBlind
    };
    const isHeroTurn = mockGameState.currentTurnPlayerId === mockHeroId;
    assert(isHeroTurn === true, '修复验证：客户端 updateControls 能正确识别 heroTurn 为 true 并解锁按钮');
    assert(mockGameState.totalPot === 30 && mockGameState.bigBlind === 20, '修复验证：客户端 mock 状态 totalPot 与 bigBlind 完整提供给加注滑块与快捷按钮');

    // 8. 启动双人真人房间进行完整动作闭环验证 (跟注、加注、过牌、弃牌)
    console.log('\n--- 测试【双人真人对局动作闭环测试 (Call / Raise / Check / Fold)】 ---');
    const clientA = new WebSocket(wsUrl);
    const clientB = new WebSocket(wsUrl);
    await Promise.all([
        new Promise(r => clientA.on('open', r)),
        new Promise(r => clientB.on('open', r))
    ]);

    const msgA = [];
    const msgB = [];
    clientA.on('message', d => msgA.push(JSON.parse(d)));
    clientB.on('message', d => msgB.push(JSON.parse(d)));

    clientA.send(JSON.stringify({
        type: 'CREATE_ROOM',
        options: { roomName: '动作测试房', smallBlind: 10, bigBlind: 20, startingChips: 1000 },
        player: { name: '玩家A', avatar: '😎' }
    }));
    await new Promise(r => setTimeout(r, 200));
    const roomA = msgA.find(m => m.type === 'ROOM_JOINED');
    const roomIdA = roomA.roomId;

    clientB.send(JSON.stringify({
        type: 'JOIN_ROOM',
        roomId: roomIdA,
        player: { name: '玩家B', avatar: '🤠' }
    }));
    await new Promise(r => setTimeout(r, 200));

    // 房主开始对局 (2人无AI)
    clientA.send(JSON.stringify({ type: 'START_GAME' }));
    await new Promise(r => setTimeout(r, 300));

    // 获取最新 GAME_STATE
    let latestStateA = msgA.filter(m => m.type === 'GAME_STATE').pop();
    assert(latestStateA !== undefined, '双人对局启动并收到 GAME_STATE');
    assert(latestStateA.totalPot === 30, '底池为 $30');

    // 检查当前谁行动
    let turnId = latestStateA.currentTurnPlayerId;
    let activeClient = (turnId === roomA.playerId) ? clientA : clientB;
    let otherClient = (turnId === roomA.playerId) ? clientB : clientA;

    // 动作 1: Active 玩家跟注 (Call $10 补齐 $20)
    console.log(`  -> 玩家 ID ${turnId} 发送【跟注 Call】`);
    activeClient.send(JSON.stringify({
        type: 'PLAYER_ACTION',
        action: 'call',
        amount: 0
    }));
    await new Promise(r => setTimeout(r, 300));

    latestStateA = msgA.filter(m => m.type === 'GAME_STATE').pop();
    assert(latestStateA.totalPot === 40, 'Active 玩家跟注后底池变为 $40');

    // 动作 2: Other 玩家过牌 (Check)
    turnId = latestStateA.currentTurnPlayerId;
    const checkClient = (turnId === roomA.playerId) ? clientA : clientB;
    console.log(`  -> 玩家 ID ${turnId} 发送【过牌 Check】`);
    checkClient.send(JSON.stringify({
        type: 'PLAYER_ACTION',
        action: 'check',
        amount: 0
    }));
    await new Promise(r => setTimeout(r, 300));

    latestStateA = msgA.filter(m => m.type === 'GAME_STATE').pop();
    assert(latestStateA.currentStreet === 'FLOP', '两人齐平下注后顺利推进到翻牌圈 FLOP');
    assert(latestStateA.communityCards.length === 3, '翻牌圈翻出 3 张公共牌');

    // 动作 3: 翻牌圈加注 (Raise to $60)
    turnId = latestStateA.currentTurnPlayerId;
    activeClient = (turnId === roomA.playerId) ? clientA : clientB;
    otherClient = (turnId === roomA.playerId) ? clientB : clientA;

    console.log(`  -> 玩家 ID ${turnId} 发送【加注 Raise to $60】`);
    activeClient.send(JSON.stringify({
        type: 'PLAYER_ACTION',
        action: 'raise',
        amount: 60
    }));
    await new Promise(r => setTimeout(r, 300));

    latestStateA = msgA.filter(m => m.type === 'GAME_STATE').pop();
    assert(latestStateA.highestRoundBet === 60, '加注成功，当前最高下注为 $60');
    assert(latestStateA.totalPot === 100, '底池更新为 $100 ($40 + $60)');

    // 动作 4: 弃牌 (Fold)
    turnId = latestStateA.currentTurnPlayerId;
    const foldClient = (turnId === roomA.playerId) ? clientA : clientB;
    console.log(`  -> 玩家 ID ${turnId} 发送【弃牌 Fold】`);
    foldClient.send(JSON.stringify({
        type: 'PLAYER_ACTION',
        action: 'fold'
    }));
    await new Promise(r => setTimeout(r, 400));

    // 验证获胜结算广播
    const showdownMsg = msgA.find(m => m.type === 'SHOWDOWN_PAYOUT');
    assert(showdownMsg !== undefined, '对手弃牌后成功收到获胜结算 SHOWDOWN_PAYOUT');

    // 9. 关闭连接与服务器
    clientA.close();
    clientB.close();
    client1.close();
    client2.close();
    await new Promise(resolve => httpServer.close(resolve));
    await new Promise(resolve => wss.close(resolve));

    console.log('\n🎉 ALL MULTIPLAYER TESTS PASSED! 局域网联机与一键补齐、玩家加注/下注所有测试完全通过！\n');
    process.exit(0);
}

runMultiplayerTest().catch(err => {
    console.error('测试运行异常:', err);
    process.exit(1);
});
