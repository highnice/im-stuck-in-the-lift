/* Multiplayer — Host / Player flow ตาม spec */
(() => {
  const entryEl = document.getElementById('entry-overlay');
  const hostPinEl = document.getElementById('host-pin-overlay');
  const hostDashEl = document.getElementById('host-dash-overlay');
  const playerJoinEl = document.getElementById('player-join-overlay');
  const playerJoinedEl = document.getElementById('player-joined-overlay');
  const resultEl = document.getElementById('result-overlay');
  const gameOverEl = document.getElementById('game-over-overlay');
  const startOverlayEl = document.getElementById('start-overlay');
  const hostBarEl = document.getElementById('host-bar');
  const toastEl = document.getElementById('host-toast');
  const statusEl = document.getElementById('server-status');
  const flashEl = document.getElementById('flash-overlay');

  const mpOverlayEls = [
    entryEl, hostPinEl, hostDashEl, playerJoinEl, playerJoinedEl, resultEl,
  ];
  const hostBtnIds = ['host-btn-next', 'host-btn-exit'];
  const CONE_AT_G_STEP = 8;
  const RESULT_POPUP_DELAY_MS = 500;
  let hostBarPhase = 'voting';

  function setServerStatus(text, ok) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.toggle('server-status-ok', !!ok);
    statusEl.classList.toggle('server-status-bad', !ok);
  }

  if (!entryEl || typeof io === 'undefined') {
    setServerStatus('ไม่ได้เชื่อม server ', false);
    return;
  }

  const PLAYER_ID_KEY = 'lift-player-id';
  const PLAYER_ROOM_KEY = 'lift-room-code';
  const HOST_ROOM_KEY = 'lift-host-room-code';
  const HOST_TOKEN_KEY = 'lift-host-token';
  const LOCAL_STARTED_KEY = 'lift-local-started';

  function getPlayerId() {
    let id = sessionStorage.getItem(PLAYER_ID_KEY);
    if (!id) {
      id = `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
      sessionStorage.setItem(PLAYER_ID_KEY, id);
    }
    return id;
  }

  function savePlayerRoom(code) {
    if (code) sessionStorage.setItem(PLAYER_ROOM_KEY, code);
    else sessionStorage.removeItem(PLAYER_ROOM_KEY);
  }

  function getSavedPlayerRoom() {
    return sessionStorage.getItem(PLAYER_ROOM_KEY) || '';
  }

  function saveHostSession(code, hostToken) {
    if (code) sessionStorage.setItem(HOST_ROOM_KEY, code);
    else sessionStorage.removeItem(HOST_ROOM_KEY);
    if (hostToken) sessionStorage.setItem(HOST_TOKEN_KEY, hostToken);
    else sessionStorage.removeItem(HOST_TOKEN_KEY);
    sessionStorage.removeItem(PLAYER_ROOM_KEY);
  }

  function getSavedHostRoom() {
    return sessionStorage.getItem(HOST_ROOM_KEY) || '';
  }

  function getSavedHostToken() {
    return sessionStorage.getItem(HOST_TOKEN_KEY) || '';
  }

  function markLocalStarted(on) {
    if (on) sessionStorage.setItem(LOCAL_STARTED_KEY, '1');
    else sessionStorage.removeItem(LOCAL_STARTED_KEY);
  }

  function wasLocalStarted() {
    return sessionStorage.getItem(LOCAL_STARTED_KEY) === '1';
  }

  function clearAllSession() {
    sessionStorage.removeItem(PLAYER_ROOM_KEY);
    sessionStorage.removeItem(HOST_ROOM_KEY);
    sessionStorage.removeItem(HOST_TOKEN_KEY);
    sessionStorage.removeItem(LOCAL_STARTED_KEY);
  }

  function tryAutoRejoin() {
    const hostCode = getSavedHostRoom();
    const hostToken = getSavedHostToken();
    if (hostCode && hostToken) {
      socket.emit('room:resume', { code: hostCode, hostToken });
      return;
    }
    const playerCode = getSavedPlayerRoom();
    if (playerCode) {
      socket.emit('room:join', { code: playerCode, playerId: getPlayerId() });
    }
  }

  const socket = io({ transports: ['websocket', 'polling'] });
  let serverOnline = false;
  let isHost = false;
  let roomCode = '';
  let goReleased = false;
  let localStarted = false;
  let roundActive = false;
  let firstSummitSceneDone = false;
  let liftFlashDone = false;
  let isAnimating = false;
  let lastPublicState = null;

  function hide(el) { if (el) el.classList.add('is-hidden'); }
  function show(el) { if (el) el.classList.remove('is-hidden'); }

  function notify(msg, kind = 'info') {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.toggle('host-toast--error', kind === 'error');
    show(toastEl);
    clearTimeout(notify._t);
    notify._t = setTimeout(() => hide(toastEl), kind === 'error' ? 3200 : 2200);
  }

  function notifyError(msg) {
    notify(msg || 'เกิดข้อผิดพลาด', 'error');
  }

  const hostPinErrorEl = document.getElementById('host-pin-error');
  const hostPinInputEl = document.getElementById('host-pin-input');
  const playerJoinErrorEl = document.getElementById('player-join-error');
  const playerJoinInputEl = document.getElementById('player-join-code');

  function clearHostPinError() {
    if (hostPinErrorEl) hide(hostPinErrorEl);
    hostPinInputEl?.classList.remove('is-invalid');
  }

  function showHostPinError(msg = 'รหัสไม่ถูกต้อง') {
    if (hostPinErrorEl) {
      hostPinErrorEl.textContent = msg;
      show(hostPinErrorEl);
    }
    hostPinInputEl?.classList.add('is-invalid');
    hostPinInputEl?.focus();
  }

  function isHostPinScreenVisible() {
    return hostPinEl && !hostPinEl.classList.contains('is-hidden');
  }

  function clearPlayerJoinError() {
    if (playerJoinErrorEl) hide(playerJoinErrorEl);
    playerJoinInputEl?.classList.remove('is-invalid');
  }

  function showPlayerJoinError(msg = 'ไม่พบห้อง ลองใหม่น้า') {
    if (playerJoinErrorEl) {
      playerJoinErrorEl.textContent = msg;
      show(playerJoinErrorEl);
    }
    playerJoinInputEl?.classList.add('is-invalid');
    playerJoinInputEl?.focus();
  }

  function isPlayerJoinScreenVisible() {
    return playerJoinEl && !playerJoinEl.classList.contains('is-hidden');
  }

  function handleServerError(err) {
    setHostBarBusy(false);
    const code = err?.code;
    const msg = err?.message || 'เกิดข้อผิดพลาด';
    if (code === 'badPin' || (isHostPinScreenVisible() && /pin wrong/i.test(msg))) {
      showHostPinError('รหัสไม่ถูกต้อง');
      return;
    }
    if (code === 'noRoom' || code === 'roomEnded' || isPlayerJoinScreenVisible()) {
      showPlayerJoinError(msg);
      return;
    }
    notifyError(msg);
  }

  function hideMpOverlays() {
    mpOverlayEls.forEach(hide);
  }

  function showOnly(...visible) {
    mpOverlayEls.forEach((el) => {
      if (!el) return;
      if (visible.includes(el)) show(el);
      else hide(el);
    });
  }

  function rememberState(state) {
    if (!state) return;
    lastPublicState = state;
    window.applyLiftSpeedMult?.(state.liftSpeedMult === 2 ? 2 : 1);
  }

  function hideStartOverlay() {
    if (!startOverlayEl) return;
    startOverlayEl.classList.add('is-hidden');
    startOverlayEl.style.removeProperty('opacity');
    startOverlayEl.style.removeProperty('visibility');
    startOverlayEl.style.removeProperty('pointer-events');
  }

  function showStartScreen() {
    hideMpOverlays();
    if (startOverlayEl) {
      startOverlayEl.style.removeProperty('opacity');
      startOverlayEl.style.removeProperty('visibility');
      startOverlayEl.style.removeProperty('pointer-events');
      show(startOverlayEl);
    }
  }

  function applyGameGo(state) {
    rememberState(state);
    goReleased = true;
    localStarted = false;
    markLocalStarted(false);
    roundActive = state?.phase === 'voting';
    showStartScreen();
    if (isHost) {
      updateHostDash(state);
      showHostBar(false);
    }
  }

  /** กลับเข้าเกมหลังรีเฟรช — ข้ามหน้า Start ถ้าเคยกด Start แล้ว */
  function resumeGameplay(state) {
    rememberState(state);
    goReleased = state.phase !== 'lobby';
    localStarted = true;
    markLocalStarted(true);
    roundActive = state.phase === 'voting';
    hideMpOverlays();
    hideStartOverlay();
    hide(gameOverEl);
    closeResultPopup(false);
    firstSummitSceneDone = true;
    liftFlashDone = true;

    if (state.phase === 'voting') {
      restoreActiveVoteScreen(state);
      restoreMyVote(state);
      return;
    }
    if (state.phase === 'round_end') {
      restoreActiveVoteScreen(state, 'round_end');
      if (window.setConeStep) window.setConeStep(state.coneStep);
      if (window.spinToFloor && state.currentFloor) window.spinToFloor(state.currentFloor);
      if (isHost) {
        setHostBarPhase('round_end', state);
        showHostBar(true);
      }
      restoreMyVote(state);
      return;
    }
    if (state.phase === 'lobby') {
      if (isHost) {
        updateHostDash(state);
        showOnly(hostDashEl);
      } else {
        const codeEl = document.getElementById('player-joined-code');
        if (codeEl) codeEl.textContent = roomCode;
        showOnly(playerJoinedEl);
      }
    }
  }

  function applyJoinedState(state) {
    rememberState(state);
    roomCode = state.code;
    isHost = !!state.isHost;
    goReleased = state.phase !== 'lobby';
    roundActive = state.phase === 'voting';
    setHostBarBusy(false);
    showHostBar(false);

    if (isHost) {
      if (state.hostToken) saveHostSession(roomCode, state.hostToken);
      updateHostDash(state);
    } else {
      savePlayerRoom(roomCode);
      const codeEl = document.getElementById('player-joined-code');
      if (codeEl) codeEl.textContent = roomCode;
    }

    const resume = wasLocalStarted() && state.phase !== 'lobby';
    if (resume) {
      resumeGameplay(state);
      return;
    }

    if (isHost) {
      if (state.phase === 'lobby') {
        showOnly(hostDashEl);
        hideStartOverlay();
      } else {
        applyGameGo(state);
        restoreMyVote(state);
      }
      return;
    }

    if (state.phase === 'lobby') {
      showOnly(playerJoinedEl);
      hideStartOverlay();
    } else {
      applyGameGo(state);
      restoreMyVote(state);
    }
  }

  function isConeAtG(state) {
    const round = state?.round ?? 0;
    const step = state?.coneStep ?? 0;
    return round >= 9 || step >= CONE_AT_G_STEP;
  }

  function updateHostNextButton(state) {
    const nextBtn = document.getElementById('host-btn-next');
    if (!nextBtn) return;

    if (hostBarPhase === 'round_end') {
      nextBtn.textContent = 'NEXT ROUTE';
      const hideRoute = isConeAtG(state);
      nextBtn.hidden = hideRoute;
      nextBtn.style.display = hideRoute ? 'none' : '';
    } else {
      nextBtn.textContent = 'NEXT';
      nextBtn.hidden = false;
      nextBtn.style.display = '';
    }
  }

  function setHostBarPhase(phase, state = lastPublicState) {
    hostBarPhase = phase;
    updateHostNextButton(state);
    syncLiftSpeedBtn();
  }

  function buildHostBarInfoHtml(state) {
    const code = state.code || roomCode || '----';
    const round = state.round ?? '-';
    const floor = state.currentFloor ?? '-';
    const voted = state?.votedCount ?? 0;
    const inVoteFlow = state.phase === 'voting' || state.phase === 'round_end';
    const voteText = inVoteFlow ? String(voted) : '—';

    return `
        <span class="hbi-item">
          <span class="hbi-label">ห้อง</span>
          <span class="hbi-value">${code}</span>
        </span>
        <span class="hbi-sep"></span>
        <span class="hbi-item">
          <span class="hbi-label">รอบ</span>
          <span class="hbi-value">${round}</span>
        </span>
        <span class="hbi-sep"></span>
        <span class="hbi-item">
          <span class="hbi-label">ชั้น</span>
          <span class="hbi-value hbi-value-floor">${floor}</span>
        </span>
        <span class="hbi-sep"></span>
        <span class="hbi-item hbi-item--vote">
          <span class="hbi-label">ส่ง</span>
          <span class="hbi-value hbi-value-vote">${voteText}</span>
        </span>`;
  }

  function updateHostDash(state) {
    const codeEl = document.getElementById('host-room-code');
    const countEl = document.getElementById('host-player-count');
    const barInfo = document.getElementById('host-bar-info');
    if (codeEl) codeEl.textContent = state?.code || roomCode;
    if (countEl && state) {
      const n = state.playerCount ?? 0;
      const voted = state.votedCount ?? 0;
      if (state.phase === 'lobby') {
        countEl.textContent = `ผู้เล่น ${n} คน เข้าร่วมแล้ว`;
      } else if (state.phase === 'voting') {
        countEl.textContent = `ส่งแล้ว ${voted} คน`;
      } else if (state.phase === 'round_end') {
        countEl.textContent = isConeAtG(state)
          ? `กลวยถึง G — กด EXIT จบเกม`
          : `ส่งรอบนี้ ${voted} คน`;
      } else {
        countEl.textContent = `ผู้เล่น ${n} คน`;
      }
    }
    if (barInfo && state) {
      barInfo.innerHTML = buildHostBarInfoHtml(state);
    }
    if (isHost && localStarted) {
      setHostBarPhase(state?.phase === 'round_end' ? 'round_end' : 'voting', state);
    }
  }

  function syncLiftSpeedBtn() {
    const speedBtn = document.getElementById('lift-speed-btn');
    if (!speedBtn || !hostBarEl) return;
    const hostBarVisible = !hostBarEl.classList.contains('is-hidden');
    const showSpeed = hostBarVisible
      && isHost
      && localStarted
      && (isAnimating || hostBarPhase === 'round_end');
    speedBtn.classList.toggle('is-hidden', !showSpeed);
  }

  function showHostBar(visible) {
    if (!hostBarEl) return;
    const showBar = visible && isHost && localStarted;
    hostBarEl.classList.toggle('is-hidden', !showBar);
    syncLiftSpeedBtn();
  }

  function setHostBarBusy(busy) {
    isAnimating = busy;
    hostBtnIds.forEach((id) => {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = busy;
    });
    syncLiftSpeedBtn();
  }

  function resetVotingUI() {
    if (window.resetPlayerVote) window.resetPlayerVote();
    const summitBtn = document.getElementById('summit-btn');
    if (summitBtn) {
      summitBtn.disabled = true;
      summitBtn.classList.remove('is-submitted');
      const label = summitBtn.querySelector('.summit-top');
      if (label) label.textContent = 'SUMMIT';
    }
    document.querySelectorAll('.floor-btn').forEach((b) => { b.disabled = false; });
    if (window.updateSummitEnabled) window.updateSummitEnabled();
  }

  function lockSummitUI(vote) {
    const summitBtn = document.getElementById('summit-btn');
    if (summitBtn) {
      summitBtn.disabled = true;
      summitBtn.classList.add('is-submitted');
      const label = summitBtn.querySelector('.summit-top');
      if (label) label.textContent = `ส่ง ${vote} แล้ว`;
    }
    document.querySelectorAll('.floor-btn').forEach((b) => { b.disabled = true; });
  }

  function restoreMyVote(state) {
    if (state?.myVote == null) return;
    lockSummitUI(state.myVote);
  }

  function hideLiftScene() {
    document.body.classList.remove('is-arrived');
    document.body.classList.add('doors-open');

    document.querySelector('.floor-indicator-container')?.classList.remove('is-visible');
    document.querySelector('.control-panel-container')?.classList.remove('is-hidden');

    const doorClose = document.getElementById('door-close-container');
    if (doorClose) {
      doorClose.classList.remove('is-closing', 'is-shrinking', 'is-opening');
      doorClose._doorClosed = false;
    }

    ['frame-container', 'monitor-container', 'panel-numbers-container', 'direct-panel-container', 'cone-container'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.setAttribute('aria-hidden', 'true');
    });
  }

  function showLiftScene() {
    document.body.classList.add('is-arrived');
    document.querySelector('.control-panel-container')?.classList.add('is-hidden');
    document.querySelector('.floor-indicator-container')?.classList.add('is-visible');

    ['frame-container', 'monitor-container', 'panel-numbers-container', 'direct-panel-container', 'cone-container'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.setAttribute('aria-hidden', 'false');
    });
  }

  /** กลับจอโหวตกลางเกม (รีเฟรช) — ไม่ใช้ hideLiftScene เพราะจะทำให้ LIFT ทับจอ */
  function restoreActiveVoteScreen(state, phase = 'voting') {
    rememberState(state);
    roundActive = phase === 'voting';
    hideMpOverlays();
    hideStartOverlay();
    closeResultPopup(false);
    hide(gameOverEl);

    document.body.classList.remove('doors-open');
    document.body.classList.add('is-arrived');
    showLiftScene();

    const doorClose = document.getElementById('door-close-container');
    if (doorClose) {
      doorClose.classList.remove('is-closing', 'is-shrinking');
      doorClose.classList.add('is-opening');
      doorClose._doorClosed = false;
    }

    const panel = document.querySelector('.panel-frame');
    if (panel) {
      panel.classList.remove('vote-panel-replay');
      panel.classList.add('is-floating');
    }

    if (window.setConeStep && state) window.setConeStep(state.coneStep);

    if (phase === 'voting') {
      resetVotingUI();
    }

    if (isHost) {
      setHostBarPhase(phase, state);
      updateHostDash(state);
      showHostBar(true);
      syncLiftSpeedBtn();
    } else {
      showHostBar(false);
    }
    if (window.updateSummitEnabled) window.updateSummitEnabled();
  }

  function returnToVoteScreen(state) {
    rememberState(state);
    roundActive = true;
    hideMpOverlays();
    hideStartOverlay();
    closeResultPopup(false);
    hide(gameOverEl);
    hideLiftScene();

    if (window.setConeStep && state) window.setConeStep(state.coneStep);
    resetVotingUI();
    if (window.replayVotePanelMotion) window.replayVotePanelMotion();

    if (isHost) {
      setHostBarPhase('voting');
      updateHostDash(state);
      showHostBar(true);
    } else {
      showHostBar(false);
    }
    if (window.updateSummitEnabled) window.updateSummitEnabled();
  }

  function showGameOverScreen() {
    hideMpOverlays();
    hideStartOverlay();
    closeResultPopup();
    showHostBar(false);
    if (gameOverEl) show(gameOverEl);
  }

  function closeResultPopup(restoreHostBar = true) {
    hide(resultEl);
    if (restoreHostBar && isHost && localStarted && hostBarPhase === 'round_end') {
      showHostBar(true);
    }
  }

  function showResultPopup(payload) {
    const floorEl = document.getElementById('result-floor');
    const totalEl = document.getElementById('result-total');
    if (floorEl) floorEl.textContent = payload.endFloor;
    if (totalEl) totalEl.textContent = `ผลรวมรอบนี้: ${payload.roundTotal}`;
    show(resultEl);
    roundActive = false;
    if (window.updateSummitEnabled) window.updateSummitEnabled();
  }

  function runTransitionOverlay(ms = 1500) {
    return new Promise((resolve) => {
      if (flashEl) {
        flashEl.classList.add('do-flash');
        setTimeout(() => {
          flashEl.classList.remove('do-flash');
          resolve();
        }, ms);
      } else {
        setTimeout(resolve, ms);
      }
    });
  }

  function enterSummitScene(onReady) {
    const finish = () => {
      firstSummitSceneDone = true;
      onReady();
    };

    if (firstSummitSceneDone) {
      finish();
      return;
    }

    const safety = setTimeout(finish, 8000);
    const doorCloseContainer = document.getElementById('door-close-container');
    const floorIndicatorContainer = document.querySelector('.floor-indicator-container');
    const controlPanel = document.querySelector('.control-panel-container');

    if (!doorCloseContainer) {
      document.body.classList.add('is-arrived');
      clearTimeout(safety);
      finish();
      return;
    }

    doorCloseContainer.classList.remove('is-closing', 'is-shrinking', 'is-opening');
    doorCloseContainer._doorClosed = false;

    const onEnd = (e) => {
      if (e.animationName !== 'doorCloseLeft' && e.animationName !== 'doorCloseRight') return;
      if (!doorCloseContainer._doorClosed) {
        doorCloseContainer._doorClosed = true;
        return;
      }
      document.body.classList.add('is-arrived');
      if (controlPanel) controlPanel.classList.add('is-hidden');
      if (floorIndicatorContainer) floorIndicatorContainer.classList.add('is-visible');
      doorCloseContainer.classList.replace('is-closing', 'is-shrinking');
      doorCloseContainer._doorClosed = false;
      setTimeout(() => {
        doorCloseContainer.classList.replace('is-shrinking', 'is-opening');
        if (isHost && localStarted) showHostBar(true);
        doorCloseContainer.removeEventListener('animationend', onEnd);
        clearTimeout(safety);
        finish();
      }, 700);
    };

    doorCloseContainer.addEventListener('animationend', onEnd);
    doorCloseContainer.classList.add('is-closing');
  }

  socket.on('room:joined', (state) => {
    clearHostPinError();
    clearPlayerJoinError();
    applyJoinedState(state);
  });

  socket.on('room:update', (state) => {
    rememberState(state);
    if (isHost) updateHostDash(state);
  });

  socket.on('lift:speed', ({ mult }) => {
    window.applyLiftSpeedMult?.(mult === 2 ? 2 : 1);
    if (lastPublicState) lastPublicState = { ...lastPublicState, liftSpeedMult: mult === 2 ? 2 : 1 };
  });

  socket.on('host:away', (msg) => {
    if (!isHost) notify(msg?.message || 'Host หลุดชั่วคราว — รอ Host กลับ', 'info');
  });

  socket.on('host:back', (msg) => {
    notify(msg?.message || 'Host กลับมาแล้ว');
  });

  socket.on('room:closed', (msg) => {
    clearAllSession();
    notifyError(msg.message || 'ห้องปิดแล้ว');
    setTimeout(() => location.reload(), 1200);
  });

  socket.on('game:go', (state) => {
    applyGameGo(state);
  });

  socket.on('round:ready', (state) => {
    returnToVoteScreen(state);
    restoreMyVote(state);
  });

  socket.on('vote:locked', ({ vote }) => {
    lockSummitUI(vote);
    /* โหวตล็อกแล้ว — ไม่แจ้ง popup */
  });

  socket.on('round:animate', async (payload) => {
    hideMpOverlays();
    hide(resultEl);
    roundActive = false;
    if (payload?.liftSpeedMult != null) {
      window.applyLiftSpeedMult?.(payload.liftSpeedMult === 2 ? 2 : 1);
    }
    if (window.updateSummitEnabled) window.updateSummitEnabled();

    if (isHost) {
      setHostBarBusy(true);
    }

    const afterAnimate = () => {
      if (isHost) {
        setHostBarBusy(false);
        const endState = {
          ...(lastPublicState || {}),
          code: roomCode,
          phase: 'round_end',
          round: payload.round,
          coneStep: payload.coneStep,
          currentFloor: payload.endFloor,
          votedCount: 0,
        };
        rememberState(endState);
        updateHostDash(endState);
        setHostBarPhase('round_end', endState);
        showHostBar(true);
      }
      setTimeout(() => showResultPopup(payload), RESULT_POPUP_DELAY_MS);
    };

    const runLift = async () => {
      showLiftScene();
      if (isHost && localStarted) showHostBar(true);
      if (!liftFlashDone) {
        await runTransitionOverlay(1500);
        liftFlashDone = true;
      }
      if (window.setConeStep) window.setConeStep(payload.coneStep);
      const path = payload.path || [];
      if (path.length <= 1) {
        afterAnimate();
        return;
      }
      if (window.playLiftPath) {
        await window.playLiftPath(path, afterAnimate);
      } else {
        afterAnimate();
      }
    };

    if (firstSummitSceneDone) {
      runLift();
    } else {
      enterSummitScene(runLift);
    }
  });

  socket.on('game:over', () => {
    roundActive = false;
    goReleased = false;
    markLocalStarted(false);
    clearAllSession();
    setHostBarBusy(false);
    showGameOverScreen();
  });

  async function checkServerHealth() {
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      const data = await res.json();
      if (data?.ok && data.gameGo) {
        setServerStatus('เชื่อมต่อ server แล้ว ✓', true);
        return true;
      }
      setServerStatus('Server เก่า โปรดรีเฟรช', false);
      return false;
    } catch {
      setServerStatus('เชื่อม server ไม่ได้ ', false);
      return false;
    }
  }

  socket.on('connect', () => {
    serverOnline = true;
    checkServerHealth();
    tryAutoRejoin();
  });

  socket.on('disconnect', () => {
    serverOnline = false;
    setServerStatus('หลุดชั่วคราว — กำลังเชื่อมใหม่...', false);
  });

  socket.on('connect_error', () => {
    serverOnline = false;
    setServerStatus('เชื่อม server ไม่ได้ ', false);
  });

  socket.on('error', handleServerError);

  socket.on('action:ok', () => {
    setHostBarBusy(false);
  });

  document.getElementById('btn-entry-host')?.addEventListener('click', () => {
    clearHostPinError();
    showOnly(hostPinEl);
    hostPinInputEl?.focus();
  });

  document.getElementById('btn-entry-player')?.addEventListener('click', () => {
    clearPlayerJoinError();
    showOnly(playerJoinEl);
    playerJoinInputEl?.focus();
  });

  document.getElementById('host-pin-back')?.addEventListener('click', () => {
    clearHostPinError();
    showOnly(entryEl);
  });
  hostPinInputEl?.addEventListener('input', clearHostPinError);
  document.getElementById('player-join-back')?.addEventListener('click', () => {
    clearPlayerJoinError();
    showOnly(entryEl);
  });
  playerJoinInputEl?.addEventListener('input', clearPlayerJoinError);

  document.getElementById('host-pin-submit')?.addEventListener('click', () => {
    clearHostPinError();
    const pin = hostPinInputEl?.value || '';
    socket.emit('room:create', { pin });
  });

  document.getElementById('player-join-submit')?.addEventListener('click', () => {
    clearPlayerJoinError();
    const code = (playerJoinInputEl?.value || '').trim();
    if (!code) {
      showPlayerJoinError('ใส่รหัสห้อง');
      return;
    }
    socket.emit('room:join', { code, playerId: getPlayerId() });
  });

  document.getElementById('host-btn-go')?.addEventListener('click', () => {
    if (!serverOnline || !socket.connected) {
      notifyError('ยังไม่ได้เชื่อม server ครับ');
      return;
    }
    if (!isHost || !roomCode) {
      notifyError('สร้างห้อง Host ก่อนนะครับ');
      return;
    }
    let done = false;
    const failTimer = setTimeout(() => {
      if (done) return;
      notifyError('Server ไม่ตอบ — เปิดเกมใหม่แล้วรีเฟรชหน้านี้ครับ');
    }, 2500);
    socket.emit('game:go', {}, (res) => {
      done = true;
      clearTimeout(failTimer);
      if (res?.ok) {
        applyGameGo(res);
        return;
      }
      if (res === undefined) {
        notifyError('Server เก่า — เปิดเกมใหม่');
        return;
      }
      if (res?.message) notifyError(res.message);
    });
  });

  function runHostAction(_label, handler) {
    if (!serverOnline || !socket.connected) {
      notifyError('ยังไม่ได้เชื่อม server');
      return;
    }
    if (!isHost || !roomCode) {
      notifyError('สร้างห้อง Host ก่อนครับ');
      return;
    }
    if (!localStarted) {
      notifyError('กด Start ก่อนครับ');
      return;
    }
    handler();
  }

  function bindHostBtn(id, label, handler) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      runHostAction(label, handler);
    });
  }

  bindHostBtn('host-btn-next', 'NEXT', () => {
    if (hostBarPhase === 'round_end') {
      closeResultPopup(false);
      showHostBar(false);
      socket.emit('round:next');
      return;
    }
    closeResultPopup();
    showHostBar(false);
    socket.emit('round:process');
  });
  bindHostBtn('host-btn-exit', 'EXIT', () => {
    if (confirm('จบเกมสำหรับทุกคนในห้องนี้นะครับ?')) {
      clearAllSession();
      socket.emit('game:end');
    }
  });

  bindHostBtn('lift-speed-btn', 'SPEED', () => {
    const next = window.getLiftSpeedMult?.() === 2 ? 1 : 2;
    window.applyLiftSpeedMult?.(next);
    socket.emit('lift:speed', { mult: next });
  });

  document.getElementById('result-close-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeResultPopup();
  });
  resultEl?.addEventListener('click', (e) => {
    if (e.target === resultEl) closeResultPopup();
  });

  function onLocalStart() {
    localStarted = true;
    markLocalStarted(true);
    if (isHost) {
      setHostBarPhase('voting');
      if (lastPublicState) updateHostDash(lastPublicState);
    }
    showHostBar(isHost);
    if (roundActive && window.updateSummitEnabled) window.updateSummitEnabled();
  }

  window.multiplayer = {
    isHost: () => isHost,
    canStart: () => goReleased,
    inGame: () => localStarted && goReleased,
    roundActive: () => roundActive && localStarted,
    submitVote: (vote) => socket.emit('vote:submit', { vote: Number(vote) }),
    hideStartOverlay,
    onLocalStart,
  };

  hideStartOverlay();
  if (getSavedHostRoom() || getSavedPlayerRoom()) {
    if (socket.connected) tryAutoRejoin();
  } else {
    showOnly(entryEl);
  }
})();
