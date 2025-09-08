(() => {
  // 配置：角色尺寸、障碍位置与尺寸（可按需修改）
  const CONFIG = {
    player: {
      // 精灵（显示）尺寸
      spriteWidth: 128 * 1.2,
      spriteHeight: 256 * 1.2,
      // 碰撞盒尺寸（用于移动/碰撞/边界）
      colliderWidth: 40,
      colliderHeight: 40,
      // 可选：精灵相对碰撞盒的偏移（默认：水平居中、脚底对齐）
      // spriteOffsetX: 0,
      // spriteOffsetY: 0
      // 行走动画参数（正弦起伏）
      walkBobAmplitude: 4,  // 像素
      walkBobFrequency: 2.5 // Hz
    },
    audio: {
      bgmSrc: './bgm_main.mp3', // 背景音乐文件路径
      bgmVolume: 0.5            // 0..1
    },
    // 前景桌面层的参考 Y（与玩家“脚底”比较）。玩家脚底 > deskY → 桌面在下层
    foreground: {
      deskY: 600
    },
    obstacles: [
      { x: 660, y: 520, width: 560, height: 20, color: '#39406a' },
    ]
  };

  /** @type {HTMLCanvasElement} */
  const canvas = document.getElementById('game');
  /** @type {CanvasRenderingContext2D} */
  const ctx = canvas.getContext('2d');

  // 固定逻辑分辨率 1280x720
  const WORLD_WIDTH = canvas.width;
  const WORLD_HEIGHT = canvas.height;

  // 玩家与旗帜数据
  const player = {
    // x/y 表示碰撞盒左上角
    x: 80,
    y: WORLD_HEIGHT - CONFIG.player.colliderHeight - 80,
    colliderWidth: CONFIG.player.colliderWidth,
    colliderHeight: CONFIG.player.colliderHeight,
    spriteWidth: CONFIG.player.spriteWidth,
    spriteHeight: CONFIG.player.spriteHeight,
    color: '#50fa7b',
    speed: 200,
    direction: 'down'
  };

  // 动画状态
  let walkTime = 0;        // 行走累计时间（秒）
  let walkIntensity = 0;   // 0..1 平滑权重（移动时趋近 1，停止时回到 0）
  
  // 自定义动画曲线数据（从CSS linear函数解析）
  const WALK_ANIMATION_CURVE = [
    { time: 0, value: 0 },
    { time: 0.011, value: 0.037 },
    { time: 0.024, value: 0.159 },
    { time: 0.089, value: 1.07 },
    { time: 0.108, value: 1.214 },
    { time: 0.117, value: 1.251 },
    { time: 0.127, value: 1.271 },
    { time: 0.14, value: 1.268 },
    { time: 0.154, value: 1.236 },
    { time: 0.222, value: 0.978 },
    { time: 0.24, value: 0.941 },
    { time: 0.258, value: 0.926 },
    { time: 0.282, value: 0.932 },
    { time: 0.349, value: 1.002 },
    { time: 0.389, value: 1.02 },
    { time: 0.52, value: 0.995 },
    { time: 0.65, value: 1.001 },
    { time: 1, value: 1 }
  ];
  
  // 动画曲线插值函数
  function getAnimationValue(time, duration = 1.0) {
    const normalizedTime = (time % duration) / duration;
    
    // 找到当前时间点对应的曲线段
    for (let i = 0; i < WALK_ANIMATION_CURVE.length - 1; i++) {
      const current = WALK_ANIMATION_CURVE[i];
      const next = WALK_ANIMATION_CURVE[i + 1];
      
      if (normalizedTime >= current.time && normalizedTime <= next.time) {
        // 线性插值
        const segmentDuration = next.time - current.time;
        const segmentProgress = (normalizedTime - current.time) / segmentDuration;
        return current.value + (next.value - current.value) * segmentProgress;
      }
    }
    
    // 如果超出范围，返回最后一个值
    return WALK_ANIMATION_CURVE[WALK_ANIMATION_CURVE.length - 1].value;
  }

  const flag = {
    x: WORLD_WIDTH - 80,
    y: WORLD_HEIGHT - 80,
    width: 30,
    height: 30
  };

  // 障碍物来自配置
  const obstacles = CONFIG.obstacles.slice();

  // 状态
  let gameOver = false;
  let lastTimeMs = 0;
  // 倒计时（秒）
  const TIMER_TOTAL_SECONDS = 60;
  let timeLeft = TIMER_TOTAL_SECONDS;
  let timerActive = true;

  // 资源
  const assets = {
    bg: null,
    fgDesk: null,
    player: { up: null, down: null, left: null, right: null },
    audio: { bgm: null }
  };

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // 输入状态
  const input = { up: false, down: false, left: false, right: false };

  function onKeyChange(e, isDown) {
    const k = e.key.toLowerCase();
    if (k === 'arrowup' || k === 'w') input.up = isDown;
    if (k === 'arrowdown' || k === 's') input.down = isDown;
    if (k === 'arrowleft' || k === 'a') input.left = isDown;
    if (k === 'arrowright' || k === 'd') input.right = isDown;
    if (isDown && k === 'r') restart();

    if (isDown) {
      if (k === 'arrowup' || k === 'w') player.direction = 'up';
      if (k === 'arrowdown' || k === 's') player.direction = 'down';
      if (k === 'arrowleft' || k === 'a') player.direction = 'left';
      if (k === 'arrowright' || k === 'd') player.direction = 'right';
    }
  }

  window.addEventListener('keydown', (e) => onKeyChange(e, true));
  window.addEventListener('keyup', (e) => onKeyChange(e, false));
  window.addEventListener('pointerdown', () => tryStartBgm());
  window.addEventListener('keydown', () => tryStartBgm());

  // 触控/点击方向键事件
  function bindControlButtons() {
    const controls = document.getElementById('controls');
    if (!controls) return;
    const btns = controls.querySelectorAll('button[data-dir]');
    const setDir = (dir, isDown) => {
      if (dir === 'up') input.up = isDown;
      if (dir === 'down') input.down = isDown;
      if (dir === 'left') input.left = isDown;
      if (dir === 'right') input.right = isDown;
      if (isDown) player.direction = dir;
    };
    btns.forEach((btn) => {
      const dir = btn.getAttribute('data-dir');
      // 支持鼠标与触摸
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); setDir(dir, true); tryStartBgm(); });
      btn.addEventListener('pointerup',   (e) => { e.preventDefault(); setDir(dir, false); });
      btn.addEventListener('pointerleave',(e) => { e.preventDefault(); setDir(dir, false); });
      btn.addEventListener('pointercancel',(e) => { e.preventDefault(); setDir(dir, false); });
    });
  }

  function restart() {
    player.x = 80;
    player.y = WORLD_HEIGHT - player.colliderHeight - 80;
    player.direction = 'down';
    gameOver = false;
    timeLeft = TIMER_TOTAL_SECONDS;
    timerActive = true;
    setStatus('到达右下角旗帜处以获胜！');
    hideOverlay();
    updateTimerUi();
  }

  function setStatus(text) {
    const el = document.getElementById('status');
    if (el) el.textContent = text;
  }
  function showOverlay(text) {
    const el = document.getElementById('overlay');
    if (!el) return;
    el.classList.remove('hidden');
    el.textContent = text;
  }
  function hideOverlay() {
    const el = document.getElementById('overlay');
    if (!el) return;
    el.classList.add('hidden');
    el.textContent = '';
  }

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  function rectsIntersect(a, b) {
    return !(a.x + a.width < b.x || a.x > b.x + b.width || a.y + a.height < b.y || a.y > b.y + b.height);
  }

  function updateTimer(dt) {
    if (!timerActive || gameOver) return;
    timeLeft -= dt;
    if (timeLeft <= 0) {
      timeLeft = 0;
      timerActive = false;
      gameOver = true;
      setStatus('时间到！按 R 重新开始');
      showOverlay('⌛ 时间到');
    }
    updateTimerUi();
  }

  function updateTimerUi() {
    const el = document.getElementById('timer');
    if (!el) return;
    const seconds = Math.ceil(timeLeft);
    el.textContent = seconds.toString();
  }

  function moveAndCollideAxis(dx, dy) {
    if (dx !== 0) {
      player.x += dx;
      for (const o of obstacles) {
        const pr = { x: player.x, y: player.y, width: player.colliderWidth, height: player.colliderHeight };
        if (rectsIntersect(pr, o)) {
          if (dx > 0) player.x = o.x - player.colliderWidth;
          else if (dx < 0) player.x = o.x + o.width;
        }
      }
    }
    if (dy !== 0) {
      player.y += dy;
      for (const o of obstacles) {
        const pr = { x: player.x, y: player.y, width: player.colliderWidth, height: player.colliderHeight };
        if (rectsIntersect(pr, o)) {
          if (dy > 0) player.y = o.y - player.colliderHeight;
          else if (dy < 0) player.y = o.y + o.height;
        }
      }
    }
  }

  function update(dt) {
    if (gameOver) return;
    updateTimer(dt);
    let moveX = 0, moveY = 0;
    if (input.left) moveX -= 1;
    if (input.right) moveX += 1;
    if (input.up) moveY -= 1;
    if (input.down) moveY += 1;
    if (moveX !== 0 && moveY !== 0) { const inv = 1 / Math.sqrt(2); moveX *= inv; moveY *= inv; }
    const dx = moveX * player.speed * dt;
    const dy = moveY * player.speed * dt;
    moveAndCollideAxis(dx, 0);
    moveAndCollideAxis(0, dy);
    player.x = clamp(player.x, 0, WORLD_WIDTH - player.colliderWidth);
    player.y = clamp(player.y, 0, WORLD_HEIGHT - player.colliderHeight);

    // 行走动画：根据是否移动更新时间与强度
    const isMoving = Math.abs(dx) > 0 || Math.abs(dy) > 0;
    if (isMoving) walkTime += dt;
    const targetIntensity = isMoving ? 1 : 0;
    const lerpRate = 8; // 趋近速度
    walkIntensity += (targetIntensity - walkIntensity) * Math.min(1, dt * lerpRate);
    if (rectsIntersect({ x: player.x, y: player.y, width: player.colliderWidth, height: player.colliderHeight }, flag)) {
      gameOver = true;
      setStatus('胜利！按 R 重新开始');
      showOverlay('🏁 胜利！');
    }
  }

  function drawObstacles() {
    ctx.save();
    for (const o of obstacles) {
      ctx.fillStyle = o.color || '#2e355a';
      ctx.fillRect(o.x, o.y, o.width, o.height);
    }
    ctx.restore();
  }

  function drawFlag() {
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(flag.x, flag.y, flag.width, flag.height);
    ctx.fillStyle = '#ef476f';
    ctx.beginPath();
    ctx.moveTo(flag.x + flag.width, flag.y);
    ctx.lineTo(flag.x + flag.width + 26, flag.y + 10);
    ctx.lineTo(flag.x + flag.width, flag.y + 20);
    ctx.closePath();
    ctx.fill();
  }

  function drawPlayer() {
    const sprite = assets.player[player.direction];
    const defaultOffsetX = Math.round((player.colliderWidth - player.spriteWidth) / 2);
    const defaultOffsetY = Math.round(player.colliderHeight - player.spriteHeight);
    const offsetX = (CONFIG.player.spriteOffsetX !== undefined) ? CONFIG.player.spriteOffsetX : defaultOffsetX;
    const offsetY = (CONFIG.player.spriteOffsetY !== undefined) ? CONFIG.player.spriteOffsetY : defaultOffsetY;
    const drawX = player.x + offsetX;
    let drawY = player.y + offsetY;
    // 叠加行走上下起伏 - 使用自定义动画曲线
    if (walkIntensity > 0 && CONFIG.player.walkBobAmplitude > 0) {
      const amp = CONFIG.player.walkBobAmplitude * walkIntensity;
      const animationValue = getAnimationValue(walkTime, 1.0 / CONFIG.player.walkBobFrequency);
      // 将动画曲线值从 [0,1] 映射到 [-1,1] 范围
      const normalizedValue = (animationValue - 0.5) * 2;
      drawY += normalizedValue * amp;
    }
    if (sprite) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(sprite, drawX, drawY, player.spriteWidth, player.spriteHeight);
    } else {
      // 回退：渲染碰撞盒
      ctx.fillStyle = 'rgba(80,250,123,0.6)';
      ctx.fillRect(player.x, player.y, player.colliderWidth, player.colliderHeight);
    }
  }

  function render() {
    ctx.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    if (assets.bg) {
      ctx.drawImage(assets.bg, 0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    } else {
      ctx.fillStyle = '#0e1330';
      ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    }
    drawObstacles();
    drawFlag();

    // 动态层级：比较玩家脚底与桌面参考线
    const playerFeetY = player.y + player.colliderHeight;
    if (assets.fgDesk && playerFeetY > CONFIG.foreground.deskY) {
      // 玩家在桌面前方（更靠下）→ 桌面在下层
      ctx.drawImage(assets.fgDesk, 0, 0, WORLD_WIDTH, WORLD_HEIGHT);
      drawPlayer();
    } else {
      // 玩家在桌面后方（更靠上）→ 桌面盖在上层
      drawPlayer();
      if (assets.fgDesk) ctx.drawImage(assets.fgDesk, 0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    }
  }

  function loop(ts) {
    const dt = Math.min((ts - lastTimeMs) / 1000, 0.05) || 0;
    lastTimeMs = ts;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  setStatus('到达右下角旗帜处以获胜！');

  function applyResponsiveScale() {
    const overlay = document.getElementById('overlay');
    const hud = document.getElementById('hud');
    const availableWidth = window.innerWidth;
    const availableHeight = window.innerHeight;
    const scale = Math.min(availableWidth / WORLD_WIDTH, availableHeight / WORLD_HEIGHT);
    const cssWidth = Math.floor(WORLD_WIDTH * scale);
    const cssHeight = Math.floor(WORLD_HEIGHT * scale);
    canvas.style.width = cssWidth + 'px';
    canvas.style.height = cssHeight + 'px';
    if (overlay) {
      overlay.style.width = WORLD_WIDTH + 'px';
      overlay.style.height = WORLD_HEIGHT + 'px';
      overlay.style.transform = 'scale(' + scale + ')';
      overlay.style.left = ((availableWidth - cssWidth) / 2) + 'px';
      overlay.style.top = ((availableHeight - cssHeight) / 2) + 'px';
    }
    if (hud) {
      hud.style.transform = 'scale(' + scale + ')';
      hud.style.left = ((availableWidth - cssWidth) / 2) + 'px';
      hud.style.top = ((availableHeight - cssHeight) / 2) + 'px';
    }
  }

  window.addEventListener('resize', applyResponsiveScale);
  window.addEventListener('orientationchange', applyResponsiveScale);
  applyResponsiveScale();
  bindControlButtons();

  Promise.all([
    loadImage('./img/bg_bakery.png').then(img => { assets.bg = img; }),
    loadImage('./img/bg_item_desk.png').then(img => { assets.fgDesk = img; }),
    loadImage('./img/player_move_up.png').then(img => { assets.player.up = img; }),
    loadImage('./img/player_move_down.png').then(img => { assets.player.down = img; }),
    loadImage('./img/player_move_left.png').then(img => { assets.player.left = img; }),
    loadImage('./img/player_move_right.png').then(img => { assets.player.right = img; })
  ]).finally(() => {
    // 预创建 BGM（遵循浏览器交互策略，真正播放在首次交互时触发）
    try {
      const bgm = new Audio(CONFIG.audio.bgmSrc);
      bgm.loop = true;
      bgm.volume = CONFIG.audio.bgmVolume;
      assets.audio.bgm = bgm;
    } catch (_) {}
    requestAnimationFrame((t) => { lastTimeMs = t; loop(t); });
  });

  let bgmStarted = false;
  function tryStartBgm() {
    if (bgmStarted) return;
    const bgm = assets.audio.bgm;
    if (!bgm) return;
    bgmStarted = true;
    bgm.play().catch(() => { bgmStarted = false; });
  }
})();


