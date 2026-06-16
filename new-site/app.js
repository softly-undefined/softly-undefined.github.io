(() => {
  const SPRITE_FONT_SIZE = "25";
  const spriteData =
    window.CLEAN_REMAP_ASCII?.sizes?.[SPRITE_FONT_SIZE]?.sprites;
  const track = document.querySelector(".sprite-track");
  const siteTitle = document.querySelector("#site-title");
  const sprite = document.querySelector("#sprite");
  const frameElement = document.querySelector("#sprite-frame");
  const gameLayer = document.querySelector("#game-layer");
  const gameGround = document.querySelector("#game-ground");
  const gameHud = document.querySelector("#game-hud");
  const gameScore = document.querySelector("#game-score");
  const gameOver = document.querySelector("#game-over");
  const gameOverArt = document.querySelector("#game-over-art");
  const secretClue = document.querySelector("#secret-clue");
  const secretClueText = document.querySelector("#secret-clue-text");

  if (
    !spriteData ||
    !track ||
    !sprite ||
    !frameElement ||
    !gameLayer ||
    !gameGround ||
    !gameHud ||
    !gameScore ||
    !gameOver ||
    !gameOverArt
  ) {
    return;
  }

  const FPS = 8;
  const FRAME_DURATION = 1000 / FPS;
  const TURN_FRAME_DURATION = 40;
  const WALK_SPEED = 325;
  const ARRIVAL_DISTANCE = 1;
  const BLINK_DELAY_MIN = 2200;
  const BLINK_DELAY_MAX = 5600;
  const TITLE_TRANSITION_DURATION = 620;

  const GAME_START_LEFT_RATIO = 0.21;
  const GAME_START_LEFT_MIN = 48;
  const GAME_START_LEFT_MAX = 420;
  const BASE_GAME_SPEED = 280;
  const MAX_GAME_SPEED = 520;
  const SPEED_SCORE_STEP = 7;
  const SPEED_TIME_STEP = 0.0065;
  const GRAVITY = 1500;
  const JUMP_START_VELOCITY = 360;
  const JUMP_HOLD_ACCELERATION = 1250;
  const JUMP_MAX_VELOCITY = 525;
  const JUMP_MAX_HOLD = 0.17;
  const JUMP_RELEASE_CUT_VELOCITY = 300;
  const JUMP_RECOVERY_TIME = 0.22;
  const FIRST_OBSTACLE_DISTANCE = 720;
  const OFFSCREEN_BUFFER = 160;
  const SPAWN_RIGHT_BUFFER_MIN = 420;
  const SPAWN_RIGHT_BUFFER_RATIO = 0.45;
  const LOW_BIRD_BOTTOM_MIN = 38;
  const LOW_BIRD_BOTTOM_MAX = 44;
  const HIGH_BIRD_BOTTOM_MIN = 88;
  const HIGH_BIRD_BOTTOM_MAX = 102;
  const GROUND_PATTERN =
    "____      .      __        '      ___    .       _        ";

  const OBSTACLE_TYPES = [
    {
      name: "marker",
      minScore: 0,
      art: normalizeAsciiBlock(`
          @
         @@@
          @
         @@@
        @@@@@
      `),
    },
    {
      name: "rock",
      minScore: 2,
      art: normalizeAsciiBlock(`
          __
        _@@@@_
       @@@@@@@@
      `),
    },
    {
      name: "double-marker",
      minScore: 5,
      art: normalizeAsciiBlock(`
          @      @
         @@@    @@@
          @      @
         @@@    @@@
        @@@@@  @@@@@
      `),
    },
    {
      name: "ridge",
      minScore: 9,
      art: normalizeAsciiBlock(`
          __      __
        _@@@@_  _@@@@_
       @@@@@@@@@@@@@@@@
      `),
    },
    {
      name: "balloon",
      minScore: 7,
      art: normalizeAsciiBlock(`
          _@@@_
        _@@@@@@@_
        @@@@@@@@@
         "@@@@P
            ||
          _@@@@_
      `),
      bottom: 10,
    },
  ];

  const LOW_BIRD_FRAMES = [
    normalizeAsciiBlock(String.raw`
        \__/
     __/@@\__
        VV
    `),
    normalizeAsciiBlock(String.raw`
     __    __
       \@@/
        VV
    `),
    normalizeAsciiBlock(String.raw`
       /@@\
     --\__/--
        VV
    `),
  ];

  const HIGH_BIRD_FRAMES = [
    normalizeAsciiBlock(String.raw`
       \    /
        \__/
       _@@@_
    `),
    normalizeAsciiBlock(String.raw`
        __
     __/@@\__
       /  \
    `),
    normalizeAsciiBlock(String.raw`
       _@@@_
       /__\
      /    \
    `),
  ];

  const BIRD_OBSTACLE_TYPES = [
    {
      name: "low-bird",
      minScore: 3,
      frames: LOW_BIRD_FRAMES,
      bottomMin: LOW_BIRD_BOTTOM_MIN,
      bottomMax: LOW_BIRD_BOTTOM_MAX,
      extraClass: "game-bird-low",
    },
    {
      name: "high-bird",
      minScore: 6,
      frames: HIGH_BIRD_FRAMES,
      bottomMin: HIGH_BIRD_BOTTOM_MIN,
      bottomMax: HIGH_BIRD_BOTTOM_MAX,
      extraClass: "game-bird-high",
    },
  ];

  let position = (window.innerWidth - sprite.offsetWidth) / 2;
  let target = position;
  let facing = 1;
  let action = "idle";
  let frameIndex = 0;
  let frameElapsed = 0;
  let turnFacing = facing;
  let lastTimestamp = performance.now();
  let blinkAt = lastTimestamp + randomBlinkDelay();
  let lastPointerX = window.innerWidth / 2;
  let mode = "free";
  let highScore = 0;
  let gameObjects = [];
  let startupNeedsFinalTurn = false;

  const textMeasureContext = document.createElement("canvas").getContext("2d");
  const maxJumpMetrics = simulateJumpMetrics(JUMP_MAX_HOLD);
  const titleText = siteTitle?.textContent || "";
  const titleCharacters = titleText.split("");
  const titleCharacterIndexes = titleCharacters.reduce((indexes, character, index) => {
    if (/\S/.test(character)) {
      indexes.push(index);
    }

    return indexes;
  }, []);
  let titleTransition = null;

  gameOverArt.textContent = normalizeAsciiBlock(gameOverArt.textContent);

  const game = {
    runTime: 0,
    distance: 0,
    score: 0,
    speed: BASE_GAME_SPEED,
    nextObstacleDistance: FIRST_OBSTACLE_DISTANCE,
    nextCloudAt: 0,
    jumpY: 0,
    jumpVelocity: 0,
    deathFallVelocity: 0,
    jumpHeld: false,
    inputHeld: false,
    jumpHoldTime: 0,
    grounded: true,
  };

  updateScoreboard();
  if (siteTitle) {
    siteTitle.textContent = titleTextForVisibleCount(0, []);
    startTitleTransition(true);
  }

  function normalizeAsciiBlock(text) {
    const lines = text.replace(/\t/g, "  ").split("\n");

    while (lines.length && lines[0].trim() === "") {
      lines.shift();
    }

    while (lines.length && lines[lines.length - 1].trim() === "") {
      lines.pop();
    }

    const indent = lines.reduce((minimum, line) => {
      if (line.trim() === "") {
        return minimum;
      }

      const leading = line.match(/^ */)[0].length;
      return Math.min(minimum, leading);
    }, Infinity);

    if (!Number.isFinite(indent)) {
      return "";
    }

    return lines.map((line) => line.slice(indent).trimEnd()).join("\n");
  }

  function randomBetween(minimum, maximum) {
    return minimum + Math.random() * (maximum - minimum);
  }

  function shuffledIndexes(indexes) {
    const shuffled = [...indexes];

    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [
        shuffled[swapIndex],
        shuffled[index],
      ];
    }

    return shuffled;
  }

  function titleTextForVisibleCount(visibleCount, order) {
    const output = [...titleCharacters];
    const visible = new Set(order.slice(0, visibleCount));

    for (const index of titleCharacterIndexes) {
      if (!visible.has(index)) {
        output[index] = " ";
      }
    }

    return output.join("");
  }

  function currentTitleVisibleIndexes() {
    if (!siteTitle) {
      return [];
    }

    const currentCharacters = siteTitle.textContent.split("");
    return titleCharacterIndexes.filter(
      (index) => currentCharacters[index] === titleCharacters[index],
    );
  }

  function startTitleTransition(toVisible) {
    if (!siteTitle) {
      return;
    }

    const visibleIndexes = currentTitleVisibleIndexes();
    const visible = new Set(visibleIndexes);
    const hiddenIndexes = titleCharacterIndexes.filter(
      (index) => !visible.has(index),
    );
    const startVisibleCount = visibleIndexes.length;
    const endVisibleCount = toVisible ? titleCharacterIndexes.length : 0;

    if (startVisibleCount === endVisibleCount) {
      titleTransition = null;
      return;
    }

    titleTransition = {
      toVisible,
      startedAt: performance.now(),
      startVisibleCount,
      endVisibleCount,
      order: toVisible
        ? [...visibleIndexes, ...shuffledIndexes(hiddenIndexes)]
        : shuffledIndexes(visibleIndexes),
    };
  }

  function updateTitleTransition(timestamp) {
    if (!siteTitle || !titleTransition) {
      return;
    }

    const progress = Math.min(
      1,
      (timestamp - titleTransition.startedAt) / TITLE_TRANSITION_DURATION,
    );
    const visibleCount = Math.round(
      titleTransition.startVisibleCount +
        (titleTransition.endVisibleCount - titleTransition.startVisibleCount) *
          progress,
    );

    siteTitle.textContent = titleTextForVisibleCount(
      visibleCount,
      titleTransition.order,
    );

    if (progress >= 1) {
      if (titleTransition.toVisible) {
        siteTitle.textContent = titleText;
      }

      titleTransition = null;
    }
  }

  function randomBlinkDelay() {
    return randomBetween(BLINK_DELAY_MIN, BLINK_DELAY_MAX);
  }

  function maxPosition() {
    return Math.max(0, window.innerWidth - sprite.offsetWidth - 12);
  }

  function frameForAction() {
    return spriteData[action] || spriteData.idle;
  }

  function lastVisibleIndex(line) {
    for (let index = line.length - 1; index >= 0; index -= 1) {
      if (/\S/.test(line[index])) {
        return index;
      }
    }

    return -1;
  }

  function visibleHorizontalOffsets() {
    const spriteRect = sprite.getBoundingClientRect();
    const frameRect = frameElement.getBoundingClientRect();
    const lines = frameElement.textContent.split("\n");
    const fontSize = getComputedStyle(frameElement).fontSize;
    textMeasureContext.font = `${fontSize} Arial, sans-serif`;

    let visibleLeft = Infinity;
    let visibleRight = 0;
    let fullWidth = 0;

    for (const line of lines) {
      const firstVisible = line.search(/\S/);
      const lastVisible = lastVisibleIndex(line);
      const lineWidth = textMeasureContext.measureText(line).width;
      fullWidth = Math.max(fullWidth, lineWidth);

      if (firstVisible === -1 || lastVisible === -1) {
        continue;
      }

      visibleLeft = Math.min(
        visibleLeft,
        textMeasureContext.measureText(line.slice(0, firstVisible)).width,
      );
      visibleRight = Math.max(
        visibleRight,
        textMeasureContext.measureText(line.slice(0, lastVisible + 1)).width,
      );
    }

    if (!Number.isFinite(visibleLeft) || fullWidth === 0) {
      return {
        left: sprite.offsetWidth / 2,
        right: sprite.offsetWidth / 2,
      };
    }

    let leftRatio = visibleLeft / fullWidth;
    let rightRatio = visibleRight / fullWidth;

    if (facing < 0) {
      [leftRatio, rightRatio] = [1 - rightRatio, 1 - leftRatio];
    }

    return {
      left: frameRect.left - spriteRect.left + frameRect.width * leftRatio,
      right: frameRect.left - spriteRect.left + frameRect.width * rightRatio,
    };
  }

  function visibleCenterOffset() {
    const offsets = visibleHorizontalOffsets();
    return (offsets.left + offsets.right) / 2;
  }

  function clampTarget(mouseX) {
    return Math.min(maxPosition(), Math.max(0, mouseX - visibleCenterOffset()));
  }

  function gameVisibleLeft() {
    return Math.min(
      GAME_START_LEFT_MAX,
      Math.max(GAME_START_LEFT_MIN, window.innerWidth * GAME_START_LEFT_RATIO),
    );
  }

  function gameStartPosition() {
    const offsets = visibleHorizontalOffsets();
    return Math.min(
      maxPosition(),
      Math.max(0, gameVisibleLeft() - offsets.left),
    );
  }

  function beginAction(nextAction) {
    if (action === nextAction || !spriteData[nextAction]) {
      return;
    }

    action = nextAction;
    frameIndex = 0;
    frameElapsed = 0;
  }

  function advanceAnimation(elapsed, timestamp) {
    const frames = frameForAction();
    frameElapsed += elapsed;
    const activeFrameDuration =
      action === "turn" ? TURN_FRAME_DURATION : FRAME_DURATION;

    while (frameElapsed >= activeFrameDuration) {
      frameElapsed -= activeFrameDuration;
      frameIndex += 1;

      if (frameIndex < frames.length) {
        continue;
      }

      if (action === "turn") {
        facing = turnFacing;
        if (mode === "turning-to-start") {
          mode = "starting";
          target = gameStartPosition();
        } else if (mode === "turning-to-run") {
          startupNeedsFinalTurn = false;
          enterRunningMode(timestamp);
          continue;
        }
        beginAction("walk");
      } else if (action === "blink") {
        beginAction("idle");
        blinkAt = timestamp + randomBlinkDelay();
      } else if (action === "die") {
        frameIndex = frames.length - 1;
      } else {
        frameIndex = 0;
      }
    }
  }

  function moveTowardTarget(elapsed) {
    const distance = target - position;

    if (Math.abs(distance) <= ARRIVAL_DISTANCE) {
      position = target;
      return false;
    }

    const desiredFacing = distance > 0 ? 1 : -1;

    if (action === "turn") {
      return false;
    }

    if (desiredFacing !== facing) {
      turnFacing = desiredFacing;
      beginAction("turn");
      return false;
    }

    const step = WALK_SPEED * (elapsed / 1000);

    if (Math.abs(distance) <= step) {
      position = target;
      return false;
    }

    position += Math.sign(distance) * step;
    return true;
  }

  function simulateJumpMetrics(holdDuration) {
    let time = 0;
    let y = 0;
    let velocity = JUMP_START_VELOCITY;
    let maxHeight = 0;
    const timestep = 1 / 240;

    while (time < 3) {
      if (time < holdDuration && velocity < JUMP_MAX_VELOCITY) {
        velocity = Math.min(
          JUMP_MAX_VELOCITY,
          velocity + JUMP_HOLD_ACCELERATION * timestep,
        );
      }

      velocity -= GRAVITY * timestep;
      y += velocity * timestep;
      maxHeight = Math.max(maxHeight, y);
      time += timestep;

      if (y <= 0 && time > 0.05) {
        return { time, maxHeight };
      }
    }

    return { time, maxHeight };
  }

  function resetGameState() {
    clearGameObjects();
    game.runTime = 0;
    game.distance = 0;
    game.score = 0;
    game.speed = BASE_GAME_SPEED;
    game.nextObstacleDistance = FIRST_OBSTACLE_DISTANCE;
    game.nextCloudAt = performance.now() + 400;
    game.jumpY = 0;
    game.jumpVelocity = 0;
    game.deathFallVelocity = 0;
    game.jumpHeld = false;
    game.inputHeld = false;
    game.jumpHoldTime = 0;
    game.grounded = true;
    startupNeedsFinalTurn = false;
    updateScoreboard();
    updateGround();
  }

  function startGame() {
    resetGameState();
    target = gameStartPosition();
    track.classList.add("is-game");
    track.classList.remove("is-game-over");
    gameHud.setAttribute("aria-hidden", "false");
    gameOver.setAttribute("aria-hidden", "true");
    startTitleTransition(false);

    const needsLeftwardWalk = position > target + ARRIVAL_DISTANCE;
    const needsRightwardWalk = position < target - ARRIVAL_DISTANCE;
    const startupTurnFacing = needsLeftwardWalk ? -1 : 1;
    startupNeedsFinalTurn = needsLeftwardWalk;

    if (
      (needsLeftwardWalk && facing > 0) ||
      (needsRightwardWalk && facing < 0) ||
      (!needsLeftwardWalk && !needsRightwardWalk && facing < 0) ||
      action === "turn"
    ) {
      mode = "turning-to-start";
      turnFacing = startupTurnFacing;
      if (action !== "turn") {
        beginAction("turn");
      }
    } else {
      mode = "starting";
    }

    if (siteTitle) {
      siteTitle.setAttribute("aria-hidden", "true");
    }
  }

  function enterRunningMode(timestamp) {
    mode = "running";
    lastTimestamp = timestamp;
    beginAction("walk");
  }

  function exitGame() {
    mode = "free";
    clearGameObjects();
    game.jumpY = 0;
    game.jumpVelocity = 0;
    game.deathFallVelocity = 0;
    game.jumpHeld = false;
    game.inputHeld = false;
    game.grounded = true;
    startupNeedsFinalTurn = false;
    track.classList.remove("is-game", "is-game-over");
    gameHud.setAttribute("aria-hidden", "true");
    gameOver.setAttribute("aria-hidden", "true");
    startTitleTransition(true);
    target = clampTarget(lastPointerX);
    beginAction("idle");
    blinkAt = performance.now() + randomBlinkDelay();

    if (siteTitle) {
      siteTitle.setAttribute("aria-hidden", "false");
    }
  }

  function endGame() {
    if (mode !== "running") {
      return;
    }

    mode = "game-over";
    highScore = Math.max(highScore, game.score);
    game.jumpHeld = false;
    game.inputHeld = false;
    game.deathFallVelocity = Math.min(game.jumpVelocity, 0);
    game.jumpVelocity = 0;
    track.classList.add("is-game-over");
    gameOver.setAttribute("aria-hidden", "false");
    updateScoreboard();
    beginAction("die");
  }

  function restartGame() {
    track.classList.remove("is-game-over");
    gameOver.setAttribute("aria-hidden", "true");
    startGame();
  }

  function updateScoreboard() {
    gameScore.textContent = `SCORE ${String(game.score).padStart(4, "0")}\nHIGH  ${String(highScore).padStart(4, "0")}`;
  }

  function trackHeight() {
    return track.clientHeight || track.getBoundingClientRect().height || 160;
  }

  function spawnX() {
    return (
      window.innerWidth +
      Math.max(SPAWN_RIGHT_BUFFER_MIN, window.innerWidth * SPAWN_RIGHT_BUFFER_RATIO)
    );
  }

  function makeGameObject(kind, art, x, y, extraClass = "") {
    const element = document.createElement("div");
    const pre = document.createElement("pre");
    element.className = `game-object game-${kind}${extraClass ? ` ${extraClass}` : ""}`;
    pre.className = "game-object-art";
    pre.textContent = art;
    element.append(pre);
    gameLayer.append(element);

    const object = {
      kind,
      element,
      pre,
      x,
      y,
      width: 0,
      counted: false,
      frameIndex: 0,
      frameElapsed: 0,
      speed: game.speed,
    };

    positionGameObject(object);
    object.width = element.getBoundingClientRect().width;
    gameObjects.push(object);

    return object;
  }

  function positionGameObject(object) {
    object.element.style.bottom = `${object.y}px`;
    object.element.style.transform = `translateX(${object.x}px)`;
  }

  function clearGameObjects() {
    for (const object of gameObjects) {
      object.element.remove();
    }

    gameObjects = [];
  }

  function makeCloudArt() {
    const width = Math.floor(randomBetween(13, 24));
    const lift = Math.floor(randomBetween(1, 5));
    const crownWidth = Math.max(4, width - lift - 4);
    const top = `${" ".repeat(lift + 2)}${"_".repeat(crownWidth)}`;
    const middle = `${" ".repeat(lift)}.-${" ".repeat(width - 4)}-.`;
    const bottom = `${" ".repeat(Math.max(0, lift - 1))}'-${"_".repeat(width - 2)}-'`;
    return `${top}\n${middle}\n${bottom}`;
  }

  function spawnCloud() {
    const object = makeGameObject(
      "cloud",
      makeCloudArt(),
      spawnX() + randomBetween(80, 260),
      randomBetween(trackHeight() * 0.45, trackHeight() * 0.74),
    );
    object.speed = randomBetween(36, 74);
  }

  function availableObstacles() {
    return [...OBSTACLE_TYPES, ...BIRD_OBSTACLE_TYPES].filter(
      (type) => game.score >= type.minScore,
    );
  }

  function spawnObstacle() {
    const choices = availableObstacles();
    const type = choices[Math.floor(Math.random() * choices.length)];
    const isBird = Boolean(type.frames);
    const object = makeGameObject(
      "obstacle",
      isBird ? type.frames[0] : type.art,
      spawnX(),
      isBird
        ? randomBetween(type.bottomMin, type.bottomMax)
        : type.bottom ?? 8,
      isBird ? `game-bird ${type.extraClass}` : type.extraClass || "",
    );
    object.speed = game.speed;
    object.name = type.name;
    object.frames = type.frames || null;
    scheduleNextObstacle(object.width);
  }

  function minimumObstacleGap(previousWidth) {
    const playerWidth = Math.max(54, frameElement.getBoundingClientRect().width * 0.42);
    const flightDistance =
      game.speed * (maxJumpMetrics.time + JUMP_RECOVERY_TIME);

    return previousWidth + playerWidth + flightDistance;
  }

  function scheduleNextObstacle(previousWidth) {
    const difficulty = Math.min(1, game.score / 28 + game.runTime / 100000);
    const safeGap = minimumObstacleGap(previousWidth);
    const extraGap = randomBetween(190, 430) * (1 - difficulty) + randomBetween(40, 120);
    game.nextObstacleDistance = game.distance + safeGap + extraGap;
  }

  function updateGround() {
    const charOffset = Math.floor(game.distance / 11) % GROUND_PATTERN.length;
    const fontSize = getComputedStyle(gameGround).fontSize;
    textMeasureContext.font = `${fontSize} Arial, sans-serif`;
    const patternWidth = Math.max(
      1,
      textMeasureContext.measureText(GROUND_PATTERN).width,
    );
    const averageCharacterWidth = patternWidth / GROUND_PATTERN.length;
    const requiredCharacters = Math.ceil(
      (window.innerWidth + Math.max(1200, window.innerWidth)) /
        averageCharacterWidth,
    );
    const repeatCount =
      Math.ceil((requiredCharacters + GROUND_PATTERN.length) / GROUND_PATTERN.length) +
      1;
    const repeated = GROUND_PATTERN.repeat(repeatCount);
    gameGround.textContent = repeated.slice(
      charOffset,
      charOffset + requiredCharacters,
    );
  }

  function beginJump() {
    if (mode !== "running" || !game.grounded) {
      return;
    }

    game.grounded = false;
    game.jumpHeld = true;
    game.jumpHoldTime = 0;
    game.jumpVelocity = JUMP_START_VELOCITY;
    beginAction("jump");
  }

  function pressJump() {
    game.inputHeld = true;
    beginJump();
  }

  function releaseJump() {
    game.inputHeld = false;
    game.jumpHeld = false;

    if (!game.grounded && game.jumpVelocity > JUMP_RELEASE_CUT_VELOCITY) {
      game.jumpVelocity = JUMP_RELEASE_CUT_VELOCITY;
    }
  }

  function updateJump(elapsedSeconds) {
    if (game.grounded) {
      return;
    }

    if (game.jumpHeld && game.jumpHoldTime < JUMP_MAX_HOLD) {
      const holdStep = Math.min(elapsedSeconds, JUMP_MAX_HOLD - game.jumpHoldTime);
      game.jumpVelocity = Math.min(
        JUMP_MAX_VELOCITY,
        game.jumpVelocity + JUMP_HOLD_ACCELERATION * holdStep,
      );
      game.jumpHoldTime += holdStep;
    }

    game.jumpVelocity -= GRAVITY * elapsedSeconds;
    game.jumpY += game.jumpVelocity * elapsedSeconds;

    if (game.jumpY <= 0) {
      game.jumpY = 0;
      game.jumpVelocity = 0;
      game.jumpHeld = false;
      game.grounded = true;

      if (game.inputHeld && mode === "running") {
        beginJump();
      }
    }
  }

  function updateDeathFall(elapsedSeconds) {
    if (game.jumpY <= 0) {
      game.jumpY = 0;
      game.deathFallVelocity = 0;
      return;
    }

    game.deathFallVelocity -= GRAVITY * elapsedSeconds;
    game.jumpY += game.deathFallVelocity * elapsedSeconds;

    if (game.jumpY <= 0) {
      game.jumpY = 0;
      game.deathFallVelocity = 0;
    }
  }

  function updateGame(elapsed, timestamp) {
    const elapsedSeconds = elapsed / 1000;
    game.runTime += elapsed;
    game.speed = Math.min(
      MAX_GAME_SPEED,
      BASE_GAME_SPEED + game.score * SPEED_SCORE_STEP + game.runTime * SPEED_TIME_STEP,
    );
    game.distance += game.speed * elapsedSeconds;

    updateJump(elapsedSeconds);
    updateGround();

    if (game.distance >= game.nextObstacleDistance) {
      spawnObstacle();
    }

    if (timestamp >= game.nextCloudAt) {
      spawnCloud();
      game.nextCloudAt = timestamp + randomBetween(1300, 3300);
    }

    for (const object of [...gameObjects]) {
      object.x -= object.speed * elapsedSeconds;

      if (object.frames) {
        object.frameElapsed += elapsed;

        if (object.frameElapsed >= 115) {
          object.frameElapsed = 0;
          object.frameIndex = (object.frameIndex + 1) % object.frames.length;
          object.pre.textContent = object.frames[object.frameIndex];
        }
      }

      positionGameObject(object);

      if (object.kind === "obstacle" && !object.counted && hasClearedPlayer(object)) {
        object.counted = true;
        game.score += 1;
        highScore = Math.max(highScore, game.score);
        updateScoreboard();
      }

      if (object.x + object.width < -OFFSCREEN_BUFFER) {
        object.element.remove();
        gameObjects = gameObjects.filter((candidate) => candidate !== object);
      }
    }

    if (isCollidingWithObstacle()) {
      endGame();
    }
  }

  function playerHitbox() {
    const trackRect = track.getBoundingClientRect();
    const frameRect = frameElement.getBoundingClientRect();
    const width = frameRect.width;
    const height = frameRect.height;

    return {
      left: frameRect.left - trackRect.left + width * 0.34,
      right: frameRect.right - trackRect.left - width * 0.29,
      top: frameRect.top - trackRect.top + height * 0.22,
      bottom: frameRect.bottom - trackRect.top - height * 0.05,
    };
  }

  function objectHitbox(object) {
    const trackRect = track.getBoundingClientRect();
    const rect = object.element.getBoundingClientRect();
    const shrinkX = Math.min(14, rect.width * 0.18);
    const shrinkY = Math.min(8, rect.height * 0.14);

    return {
      left: rect.left - trackRect.left + shrinkX,
      right: rect.right - trackRect.left - shrinkX,
      top: rect.top - trackRect.top + shrinkY,
      bottom: rect.bottom - trackRect.top - shrinkY * 0.5,
    };
  }

  function hasClearedPlayer(object) {
    return objectHitbox(object).right < playerHitbox().left;
  }

  function rectanglesOverlap(first, second) {
    return (
      first.left < second.right &&
      first.right > second.left &&
      first.top < second.bottom &&
      first.bottom > second.top
    );
  }

  function isCollidingWithObstacle() {
    const player = playerHitbox();

    return gameObjects.some((object) => {
      if (object.kind !== "obstacle") {
        return false;
      }

      return rectanglesOverlap(player, objectHitbox(object));
    });
  }

  function handleFreeOrStartingAnimation(isWalking, timestamp) {
    if (action === "turn") {
      return;
    }

    if (isWalking) {
      beginAction("walk");
    } else if (mode === "starting") {
      if (startupNeedsFinalTurn && facing < 0) {
        mode = "turning-to-run";
        turnFacing = 1;
        beginAction("turn");
        return;
      }

      enterRunningMode(timestamp);
    } else if (action === "walk") {
      beginAction("idle");
      blinkAt = timestamp + randomBlinkDelay();
    } else if (action === "idle" && timestamp >= blinkAt) {
      beginAction("blink");
    }
  }

  function handleRunningAnimation() {
    if (mode === "game-over") {
      beginAction("die");
      return;
    }

    if (game.grounded) {
      beginAction("walk");
    } else {
      beginAction("jump");
    }
  }

  function render(timestamp) {
    const elapsed = Math.min(timestamp - lastTimestamp, 100);
    lastTimestamp = timestamp;

    let isWalking = false;

    if (mode === "free" || mode === "starting") {
      isWalking = moveTowardTarget(elapsed);
      handleFreeOrStartingAnimation(isWalking, timestamp);
    } else if (mode === "turning-to-start" || mode === "turning-to-run") {
      // The turn animation controls when startup movement or running begins.
    } else {
      handleRunningAnimation();
    }

    if (mode === "running") {
      updateGame(elapsed, timestamp);
    } else if (mode === "game-over") {
      updateDeathFall(elapsed / 1000);
    }

    updateTitleTransition(timestamp);
    advanceAnimation(elapsed, timestamp);

    sprite.style.transform = `translate(${position}px, ${-game.jumpY}px)`;
    sprite.dataset.action = action;
    sprite.dataset.facing = facing > 0 ? "right" : "left";
    frameElement.style.setProperty("--facing", facing);

    const frames = frameForAction();
    frameElement.textContent = frames[Math.min(frameIndex, frames.length - 1)];

    requestAnimationFrame(render);
  }

  document.addEventListener("pointermove", (event) => {
    lastPointerX = event.clientX;

    if (mode === "free") {
      target = clampTarget(event.clientX);
    }
  });

  secretClue?.addEventListener("click", () => {
    if (!secretClueText) {
      return;
    }

    secretClueText.hidden = !secretClueText.hidden;
  });

  sprite.addEventListener("pointerdown", (event) => {
    if (mode !== "free") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    startGame();
  });

  track.addEventListener("pointerdown", (event) => {
    if (mode === "running") {
      event.preventDefault();
      pressJump();
    } else if (mode === "game-over") {
      event.preventDefault();
      restartGame();
    }
  });

  document.addEventListener("pointerup", () => {
    if (mode === "running") {
      releaseJump();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.code === "Escape" && mode !== "free") {
      event.preventDefault();
      exitGame();
      return;
    }

    if (event.code !== "Space" && event.code !== "ArrowUp") {
      return;
    }

    if (mode === "game-over") {
      event.preventDefault();
      restartGame();
      return;
    }

    if (mode !== "running") {
      return;
    }

    event.preventDefault();
    game.inputHeld = true;

    if (!event.repeat) {
      beginJump();
    }
  });

  document.addEventListener("keyup", (event) => {
    if (event.code !== "Space" && event.code !== "ArrowUp") {
      return;
    }

    if (mode === "running") {
      event.preventDefault();
      releaseJump();
    }
  });

  window.addEventListener("resize", () => {
    if (mode === "free") {
      position = Math.min(position, maxPosition());
      target = Math.min(target, maxPosition());
      return;
    }

    target = gameStartPosition();
    position = target;
  });

  requestAnimationFrame(render);
})();
