import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { setupScene } from './setup.js';
import { UIManager } from './ui.js';
import { Game } from './game.js';
import { ReplayRecorder } from './replay.js';
import { CanvasUI } from './canvas-ui.js';

// Global state
let game, ui, replayRecorder, canvasUI;
let scene, world, camera, renderer, uiScene, uiCamera;
let currentScore = 0;
let isScoreSubmitted = false;
let cheatKeyHeld = false;
let cheatInterval = null;

const room = new WebsimSocket();

function init() {
    const {
        scene: s,
        world: w,
        camera: c,
        renderer: r,
        defaultMaterial: dm,
        uiScene: us,
        uiCamera: uc
    } = setupScene();
    scene = s;
    world = w;
    camera = c;
    renderer = r;
    uiScene = us;
    uiCamera = uc;

    ui = new UIManager();
    canvasUI = new CanvasUI(uiScene);

    const gameCallbacks = {
        onScoreUpdate: (score) => {
            ui.updateScore(score);
            canvasUI.updateScore(score);
        },
        onGameOver: (score) => {
            setTimeout(() => {
                replayRecorder?.stop();
            }, 3000);
            currentScore = score;
            isScoreSubmitted = false;
            ui.showGameOver(score);
            ui.setSubmitButtonState(false, 'Submit Score');
        }
    };

    game = new Game(scene, world, dm, camera, gameCallbacks);
    
    setupEventListeners();
    
    room.collection('score_v1').subscribe(scores => {
        const sortedScores = scores.sort((a, b) => b.score - a.score);
        ui.updateLeaderboard(sortedScores, (replayUrl) => {
            ui.showReplayViewer(replayUrl);
        });
    });

    renderer.setAnimationLoop(animate);
    startGame();
}

function startGame() {
    game.start();
    ui.hideGameOver();
    ui.showInstructions(true);
    canvasUI.updateScore(0);
    
    replayRecorder = new ReplayRecorder(renderer.domElement);
}

function restart() {
    replayRecorder?.stop();
    game.restart();
    startGame();
}

async function viewReplay() {
    ui.setReplayButtonState(true, 'Rendering...');
    const blob = await replayRecorder.getReplayBlob();
    if (blob) {
        ui.showReplayViewer(blob);
    }
    ui.setReplayButtonState(false, 'Watch Replay');
}

async function submitScore() {
    if (isScoreSubmitted) return;
    
    ui.setSubmitButtonState(true, 'Submitting...');

    try {
        ui.setReplayButtonState(true, 'Uploading...');
        const replayBlob = await replayRecorder.getReplayBlob();
        if (!replayBlob) {
            throw new Error("Could not get replay blob.");
        }
        
        const replayUrl = await window.websim.upload(replayBlob);
        ui.setReplayButtonState(false, 'Watch Replay');

        const currentUser = await window.websim.getCurrentUser();
        const userScores = room.collection('score_v1').filter({ username: currentUser.username }).getList();
        
        userScores.sort((a, b) => a.score - b.score);

        if (userScores.length < 3) {
            await room.collection('score_v1').create({ score: currentScore, replayUrl });
        } else {
            const lowestScore = userScores[0];
            if (currentScore > lowestScore.score) {
                await room.collection('score_v1').update(lowestScore.id, { score: currentScore, replayUrl });
            }
        }
        isScoreSubmitted = true;
        ui.setSubmitButtonState(true, 'Submitted!');

    } catch (error) {
        console.error("Failed to submit score:", error);
        ui.setSubmitButtonState(false, 'Submit Score');
        ui.setReplayButtonState(false, 'Watch Replay');
        alert("There was an error submitting your score. Please try again.");
    }
}

function setupEventListeners() {
    ui.setupEventListeners({
        onPointerDown: () => {
            if (game.getState() === 'playing') {
                ui.showInstructions(false);
                game.onPointerDown();
            }
        },
        onRestart: restart,
        onViewReplay: viewReplay,
        onSubmitScore: submitScore,
        onViewLeaderboard: () => ui.showLeaderboard(),
        onCloseLeaderboard: () => {
            ui.hideLeaderboard();
            const gameState = game.getState();
            if (gameState === 'gameover') {
                ui.showGameOver(currentScore);
            } else if (gameState !== 'playing') {
                restart();
            }
            // If game is 'playing', do nothing extra, just hide the leaderboard.
        },
        onWindowResize: () => {
            const aspect = window.innerWidth / window.innerHeight;
            const frustumSize = 4;
            camera.left = frustumSize * aspect / -2;
            camera.right = frustumSize * aspect / 2;
            camera.top = frustumSize / 2;
            camera.bottom = frustumSize / -2;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);

            uiCamera.left = -window.innerWidth / 2;
            uiCamera.right = window.innerWidth / 2;
            uiCamera.top = window.innerHeight / 2;
            uiCamera.bottom = -window.innerHeight / 2;
            uiCamera.updateProjectionMatrix();
            canvasUI.onWindowResize();
        }
    });

    window.addEventListener('keydown', (e) => {
        if (e.code === 'Backquote' && game.getState() === 'playing') {
            if (!cheatKeyHeld) {
                cheatKeyHeld = true;
                ui.showInstructions(false);
                game.placeBlockPerfectly(); // Place one immediately
                if (cheatInterval) clearInterval(cheatInterval);
                cheatInterval = setInterval(() => {
                    if (game.getState() === 'playing') {
                        game.placeBlockPerfectly();
                    } else {
                        // Game over or other state, stop cheating
                        cheatKeyHeld = false;
                        if (cheatInterval) {
                            clearInterval(cheatInterval);
                            cheatInterval = null;
                        }
                    }
                }, 100);
            }
        }
    });

    window.addEventListener('keyup', (e) => {
        if (e.code === 'Backquote') {
            cheatKeyHeld = false;
            if (cheatInterval) {
                clearInterval(cheatInterval);
                cheatInterval = null;
            }
        }
    });
}

function animate() {
    world.step(1 / 60);
    game.update();
    
    renderer.clear();
    renderer.render(scene, camera);
    renderer.clearDepth();
    renderer.render(uiScene, uiCamera);
}

init();