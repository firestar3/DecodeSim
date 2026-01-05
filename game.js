const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- CONSTANTS ---
const FIELD_WIDTH = 2000;
const FIELD_HEIGHT = 1400; // Aspect ratio approx 1.4
const ROBOT_SIZE = 40;
const ARTIFACT_RADIUS = 8;
const GOAL_SIZE = 120;
const MAX_INVENTORY = 3;

const COLORS = {
    red: '#ff2a2a',
    redGlow: 'rgba(255, 42, 42, 0.4)',
    blue: '#2a8aff',
    blueGlow: 'rgba(42, 138, 255, 0.4)',
    purple: '#bd00ff',
    green: '#00ff9d',
    wall: '#444',
    grid: '#222'
};

// --- GAME STATE ---
const gameState = {
    running: false,
    timeLeft: 120, // 2 minutes
    lastTime: 0,
    robots: [],
    artifacts: [],
    particles: [],
    targetPattern: [], // ['purple', 'purple', 'green']
    redScore: 0,
    blueScore: 0,
    redHistory: [],
    blueHistory: []
};

// --- CLASSES ---

class Vector2 {
    constructor(x, y) { this.x = x; this.y = y; }
    add(v) { this.x += v.x; this.y += v.y; return this; }
    sub(v) { this.x -= v.x; this.y -= v.y; return this; }
    mult(n) { this.x *= n; this.y *= n; return this; }
    mag() { return Math.sqrt(this.x * this.x + this.y * this.y); }
    normalize() {
        let m = this.mag();
        if (m > 0) this.mult(1 / m);
        return this;
    }
    copy() { return new Vector2(this.x, this.y); }
    dist(v) { return Math.sqrt(Math.pow(this.x - v.x, 2) + Math.pow(this.y - v.y, 2)); }
}

class Particle {
    constructor(x, y, color, speed, life) {
        this.pos = new Vector2(x, y);
        this.vel = new Vector2(Math.random() - 0.5, Math.random() - 0.5).normalize().mult(speed);
        this.color = color;
        this.life = life;
        this.maxLife = life;
    }
    update() {
        this.pos.add(this.vel);
        this.life--;
        this.vel.mult(0.95); // friction
    }
    draw(ctx) {
        ctx.globalAlpha = this.life / this.maxLife;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.pos.x, this.pos.y, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }
}

class Robot {
    constructor(id, x, y, color, controls) {
        this.id = id;
        this.pos = new Vector2(x, y);
        this.vel = new Vector2(0, 0);
        this.angle = id === 'red' ? 0 : Math.PI;
        this.color = color;
        this.controls = controls;
        this.inventory = [];
        this.cooldown = 0;
        this.speed = 5;
    }

    update(input) {
        // Movement
        let moveVec = new Vector2(0, 0);
        if (input[this.controls.up]) moveVec.y -= 1;
        if (input[this.controls.down]) moveVec.y += 1;
        if (input[this.controls.left]) moveVec.x -= 1;
        if (input[this.controls.right]) moveVec.x += 1;

        if (moveVec.mag() > 0) {
            moveVec.normalize().mult(0.5); // Acceleration
            this.vel.add(moveVec);
            this.angle = Math.atan2(this.vel.y, this.vel.x);
        }

        // Friction & Cap
        this.vel.mult(0.92);
        this.pos.add(this.vel);

        // Bounds
        this.pos.x = Math.max(ROBOT_SIZE, Math.min(FIELD_WIDTH - ROBOT_SIZE, this.pos.x));
        this.pos.y = Math.max(ROBOT_SIZE, Math.min(FIELD_HEIGHT - ROBOT_SIZE, this.pos.y));

        // Action (Intake/Shoot)
        if (input[this.controls.action] && this.cooldown <= 0) {
            this.action();
            this.cooldown = 15; // Frames cooldown
        }
        if (this.cooldown > 0) this.cooldown--;
    }

    action() {
        // Try Intake first
        if (this.inventory.length < MAX_INVENTORY) {
            let found = false;
            for (let a of gameState.artifacts) {
                if (!a.held && !a.scored && this.pos.dist(a.pos) < ROBOT_SIZE + 20) {
                    a.held = true;
                    a.holder = this;
                    this.inventory.push(a);
                    found = true;
                    break;
                }
            }
            if (found) return;
        }

        // Shoot if has inventory
        if (this.inventory.length > 0) {
            let a = this.inventory.shift();
            a.held = false;
            a.holder = null;
            // Set position slightly in front
            let dir = new Vector2(Math.cos(this.angle), Math.sin(this.angle));
            a.pos = this.pos.copy().add(dir.copy().mult(ROBOT_SIZE + 10));
            a.vel = dir.mult(15); // Shoot speed
            // Recoil
            this.vel.sub(dir.copy().mult(0.2));
            spawnParticles(a.pos.x, a.pos.y, '#fff', 5);
        }
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.pos.x, this.pos.y);
        ctx.rotate(this.angle);

        // Glow
        ctx.shadowBlur = 20;
        ctx.shadowColor = this.color;

        // Body
        ctx.fillStyle = '#222';
        ctx.fillRect(-ROBOT_SIZE / 2, -ROBOT_SIZE / 2, ROBOT_SIZE, ROBOT_SIZE);
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 3;
        ctx.strokeRect(-ROBOT_SIZE / 2, -ROBOT_SIZE / 2, ROBOT_SIZE, ROBOT_SIZE);

        // Direction Indicator
        ctx.fillStyle = this.color;
        ctx.fillRect(ROBOT_SIZE / 2 - 5, -5, 10, 10);

        // Inventory Indicator
        ctx.shadowBlur = 0;
        for (let i = 0; i < this.inventory.length; i++) {
            ctx.fillStyle = this.inventory[i].type === 'purple' ? COLORS.purple : COLORS.green;
            ctx.beginPath();
            ctx.arc(-10 + (i * 10), 0, 3, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }
}

class Artifact {
    constructor(x, y, type) {
        this.pos = new Vector2(x, y);
        this.vel = new Vector2(0, 0);
        this.type = type; // 'purple' or 'green'
        this.held = false;
        this.holder = null;
        this.scored = false;
    }

    update() {
        if (this.scored) return; // Don't update if scored (removed from main loop logic usually)

        if (this.held) {
            // Follow robot
            // We just let the inventory render handle logic or attach position here
            return;
        }

        this.pos.add(this.vel);
        this.vel.mult(0.98); // Friction

        // Wall Bounce
        if (this.pos.x < ARTIFACT_RADIUS || this.pos.x > FIELD_WIDTH - ARTIFACT_RADIUS) this.vel.x *= -1;
        if (this.pos.y < ARTIFACT_RADIUS || this.pos.y > FIELD_HEIGHT - ARTIFACT_RADIUS) this.vel.y *= -1;
    }

    draw(ctx) {
        if (this.held || this.scored) return;

        ctx.save();
        ctx.translate(this.pos.x, this.pos.y);
        ctx.shadowBlur = 10;
        ctx.shadowColor = this.type === 'purple' ? COLORS.purple : COLORS.green;
        ctx.fillStyle = this.type === 'purple' ? COLORS.purple : COLORS.green;
        ctx.beginPath();
        ctx.arc(0, 0, ARTIFACT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

// --- SETUP & UTILS ---

let input = {};
window.addEventListener('keydown', e => input[e.code] = true);
window.addEventListener('keyup', e => input[e.code] = false);

// Init Robots
gameState.robots.push(new Robot('red', 100, FIELD_HEIGHT / 2, COLORS.red, { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', action: 'KeyF' }));
gameState.robots.push(new Robot('blue', FIELD_WIDTH - 100, FIELD_HEIGHT / 2, COLORS.blue, { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', action: 'KeyM' }));

// Init Artifacts
function spawnArtifacts() {
    gameState.artifacts = [];
    for (let i = 0; i < 24; i++) { // 24 Purple
        gameState.artifacts.push(new Artifact(Math.random() * (FIELD_WIDTH - 200) + 100, Math.random() * (FIELD_HEIGHT - 200) + 100, 'purple'));
    }
    for (let i = 0; i < 12; i++) { // 12 Green
        gameState.artifacts.push(new Artifact(Math.random() * (FIELD_WIDTH - 200) + 100, Math.random() * (FIELD_HEIGHT - 200) + 100, 'green'));
    }
}

// Generate Pattern
function generatePattern() {
    const types = ['purple', 'green'];
    gameState.targetPattern = [
        types[Math.floor(Math.random() * 2)],
        types[Math.floor(Math.random() * 2)],
        types[Math.floor(Math.random() * 2)]
    ];
    updatePatternUI();
}

function updatePatternUI() {
    const container = document.getElementById('target-pattern');
    container.innerHTML = '';
    gameState.targetPattern.forEach(type => {
        let dot = document.createElement('div');
        dot.className = `pattern-dot dot-${type}`;
        container.appendChild(dot);
    });
}

function updateInventoryUI() {
    // Red
    let redInv = gameState.robots[0].inventory;
    document.querySelectorAll('#red-panel .slot').forEach((el, i) => {
        el.className = 'slot'; // reset
        if (i < redInv.length) el.classList.add(`filled-${redInv[i].type}`);
    });

    // Blue
    let blueInv = gameState.robots[1].inventory;
    document.querySelectorAll('#blue-panel .slot').forEach((el, i) => {
        el.className = 'slot'; // reset
        if (i < blueInv.length) el.classList.add(`filled-${blueInv[i].type}`);
    });
}

function spawnParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        gameState.particles.push(new Particle(x, y, color, 4, 30));
    }
}

// --- GAME LOOP ---

function update() {
    if (!gameState.running) {
        if (input['Space']) startGame();
        return;
    }

    // Time
    if (Date.now() - gameState.lastTime >= 1000) {
        gameState.timeLeft--;
        if (gamestate.timeleft == 60000){
            for (let i = 0; i < 24; i++) { // 24 Purple
                gameState.artifacts.push(new Artifact(Math.random() * (FIELD_WIDTH - 200) + 100, Math.random() * (FIELD_HEIGHT - 200) + 100, 'purple'));
            }
            for (let i = 0; i < 12; i++) { // 12 Green
                gameState.artifacts.push(new Artifact(Math.random() * (FIELD_WIDTH - 200) + 100, Math.random() * (FIELD_HEIGHT - 200) + 100, 'green'));
            }
        gameState.lastTime = Date.now();
        let m = Math.floor(gameState.timeLeft / 60);
        let s = gameState.timeLeft % 60;
        document.getElementById('timer').innerText = `${m}:${s.toString().padStart(2, '0')}`;

        if (gameState.timeLeft <= 0) endGame();
    }

    gameState.robots.forEach(r => r.update(input));

    // Artifact Logic & Goal Checking
    // Goals are at corners: Red Goal (Top Left), Blue Goal (Bottom Right) ??
    // Actually simplicity: Red Goal Top-Left, Blue Goal Top-Right? 
    // Let's do Red Side (Left) and Blue Side (Right).
    // Goals are triangular holes in the back wall.

    // Red Goal Area: x < 100, y < 100 (Top Left) + y > Height-100 (Bottom Left)?
    // Let's simplified goal: Red Goal is a zone on the Left Wall (Height/2).
    // Blue Goal is a zone on the Right Wall.

    let redGoalPos = new Vector2(50, FIELD_HEIGHT / 2);
    let blueGoalPos = new Vector2(FIELD_WIDTH - 50, FIELD_HEIGHT / 2);

    gameState.artifacts.forEach(a => {
        if (!a.held && !a.scored) {
            a.update();

            // Check Collision with Robots (Push)
            gameState.robots.forEach(r => {
                if (r.pos.dist(a.pos) < ROBOT_SIZE / 2 + ARTIFACT_RADIUS) {
                    let pushDir = a.pos.copy().sub(r.pos).normalize();
                    a.vel.add(pushDir.mult(2));
                }
            });

            // Check Goal Scoring
            // Red scores in 'Red Goal' (Left Wall) - Wait, usually you score in opponent side? 
            // In FTC you score in YOUR goal. Let's assume Red Goal is on LEFT.
            if (a.pos.dist(redGoalPos) < GOAL_SIZE && !a.scored) {
                scoreArtifact('red', a);
            } else if (a.pos.dist(blueGoalPos) < GOAL_SIZE && !a.scored) {
                scoreArtifact('blue', a);
            }
        }
    });

    for (let i = gameState.particles.length - 1; i >= 0; i--) {
        let p = gameState.particles[i];
        p.update();
        if (p.life <= 0) gameState.particles.splice(i, 1);
    }

    updateInventoryUI();
}

function scoreArtifact(team, artifact) {
    artifact.scored = true;
    spawnParticles(artifact.pos.x, artifact.pos.y, team === 'red' ? COLORS.red : COLORS.blue, 20);

    let points = artifact.type === 'purple' ? 5 : 10;

    if (team === 'red') {
        gameState.redScore += points;
        document.getElementById('red-score').innerText = gameState.redScore;
        gameState.redHistory.push(artifact.type);
        if (gameState.redHistory.length > 3) gameState.redHistory.shift();
        checkPattern('red');
    } else {
        gameState.blueScore += points;
        document.getElementById('blue-score').innerText = gameState.blueScore;
        gameState.blueHistory.push(artifact.type);
        if (gameState.blueHistory.length > 3) gameState.blueHistory.shift();
        checkPattern('blue');
    }
}

function checkPattern(team) {
    let history = gameState[team + 'History'];
    let target = gameState.targetPattern;

    if (history.length < 3) return;

    let match = true;
    for (let i = 0; i < 3; i++) {
        if (history[i] !== target[i]) match = false;
    }

    if (match) {
        // BONUS!
        let bonus = 20;
        if (team === 'red') {
            gameState.redScore += bonus;
            document.getElementById('red-score').innerText = gameState.redScore;
        } else {
            gameState.blueScore += bonus;
            document.getElementById('blue-score').innerText = gameState.blueScore;
        }

        // Visual Feedback
        let msg = document.getElementById('game-message');
        msg.innerText = `${team.toUpperCase()} MATCHED PATTERN (+30)!`;
        msg.classList.remove('hidden');
        setTimeout(() => {
            if (gameState.running) msg.classList.add('hidden');
        }, 2000);

        // Reset History to avoid double counting? Or generate new pattern?
        // Let's generate new pattern
        generatePattern();
        gameState.redHistory = [];
        gameState.blueHistory = [];
    }
}

function draw() {
    // Coordinate System scaling
    // We want the field to fit in the screen but maintain aspect ratio.
    const scale = Math.min(canvas.width / FIELD_WIDTH, canvas.height / FIELD_HEIGHT);
    const offsetX = (canvas.width - FIELD_WIDTH * scale) / 2;
    const offsetY = (canvas.height - FIELD_HEIGHT * scale) / 2;

    // Clear
    ctx.fillStyle = '#0a0a10';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    // Draw Field
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 5;
    ctx.strokeRect(0, 0, FIELD_WIDTH, FIELD_HEIGHT);

    // Grid
    ctx.save();
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= FIELD_WIDTH; x += 100) { ctx.moveTo(x, 0); ctx.lineTo(x, FIELD_HEIGHT); }
    for (let y = 0; y <= FIELD_HEIGHT; y += 100) { ctx.moveTo(0, y); ctx.lineTo(FIELD_WIDTH, y); }
    ctx.stroke();
    ctx.restore();

    // Draw Goals
    // Red Goal (Left)
    ctx.fillStyle = 'rgba(255, 42, 42, 0.1)';
    ctx.beginPath();
    ctx.arc(50, FIELD_HEIGHT / 2, GOAL_SIZE, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLORS.red;
    ctx.lineWidth = 5;
    ctx.stroke();

    // Blue Goal (Right)
    ctx.fillStyle = 'rgba(42, 138, 255, 0.1)';
    ctx.beginPath();
    ctx.arc(FIELD_WIDTH - 50, FIELD_HEIGHT / 2, GOAL_SIZE, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLORS.blue;
    ctx.stroke();


    // Entities
    gameState.artifacts.forEach(a => a.draw(ctx));
    gameState.particles.forEach(p => p.draw(ctx));
    gameState.robots.forEach(r => r.draw(ctx));

    ctx.restore();

    requestAnimationFrame(function () {
        update();
        draw();
    });
}

function startGame() {
    gameState.running = true;
    gameState.timeLeft = 120;
    gameState.lastTime = Date.now();
    gameState.redScore = 0;
    gameState.blueScore = 0;
    document.getElementById('game-message').classList.add('hidden');
    spawnArtifacts();
    generatePattern();

    // Reset Robots
    gameState.robots[0].pos = new Vector2(100, FIELD_HEIGHT / 2);
    gameState.robots[0].inventory = [];
    gameState.robots[1].pos = new Vector2(FIELD_WIDTH - 100, FIELD_HEIGHT / 2);
    gameState.robots[1].inventory = [];
    gameState.redHistory = [];
    gameState.blueHistory = [];

    document.getElementById('red-score').innerText = '0';
    document.getElementById('blue-score').innerText = '0';
}

function endGame() {
    gameState.running = false;
    let winner = gameState.redScore > gameState.blueScore ? "RED WINS" : (gameState.blueScore > gameState.redScore ? "BLUE WINS" : "TIE");
    let msg = document.getElementById('game-message');
    msg.innerText = `${winner} - PRESS SPACE TO RESTART`;
    msg.classList.remove('hidden');
}

// Initial Resize
function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// Start Loop
requestAnimationFrame(function () {
    update();
    draw();
});

