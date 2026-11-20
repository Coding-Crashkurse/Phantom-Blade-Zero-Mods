// Jetpack for Phantom Blade Zero: a PBZModLoader mod.
//
// Press L1 twice quickly (keyboard: J once) to switch the jetpack on; the same again switches it off.
// While it is on:
//   left stick / W A S D     fly where the camera looks (look up and push forward to climb)
//   A or Cross / Space       straight up
//   B or Circle / Left Ctrl  straight down
//   L2 / Left Shift          boost
// With nothing pressed you hover. Switch it off in the air and you fall as usual.
//
// How: 60 times a second the mod reads the keys. While the jetpack is on it turns the player's gravity off and sets
// the player's speed with the engine's LaunchCharacter. Walls and floors still stop you.
//
// Change the numbers below, save, run install_mods.py and press Alt+F5 in the game to load them.

const SETTINGS = {
    TOGGLE_PAD: "Gamepad_LeftShoulder",   // press twice
    TOGGLE_KEYBOARD: "J",                 // press once
    DOUBLE_TAP_MS: 350,   // the two L1 presses must be this close together
    FLY_SPEED: 1800,      // cm per second (the player's sprint is roughly 600 to 800)
    BOOST: 2.5,           // speed multiplier while boost is held
    RESPONSE: 6,          // how quickly the flight follows your input (higher = snappier)
    EFFECT: true,         // dust puffs under the player while the jetpack moves
    EFFECT_MS: 120,       // time between two puffs
};

const UE = require("ue");
const puerts = require("puerts");

const JUMP_ACTION = "/PBZInput/InputActions/IA_Jump.IA_Jump";
const EFFECT_SYSTEM = "/PBZVFXPack/VFX/BattleFX/Common/Jump/NS_Jump_Stone_301.NS_Jump_Stone_301";
const STICK_DEAD_ZONE = 0.25;
const TICK_MS = 16;

const log = (text) => console.log("[PBZMOD] [Jetpack] " + text);
const gameInstance = puerts.argv.getByName("GameInstance");
if (!gameInstance)
    throw new Error("Jetpack: the game instance is missing");

const key = (name) => { const k = new UE.Key(); k.KeyName = name; return k; };
const KEYS = {
    togglePad: key(SETTINGS.TOGGLE_PAD), toggleKeyboard: key(SETTINGS.TOGGLE_KEYBOARD),
    forward: key("W"), back: key("S"), left: key("A"), right: key("D"),
    up: [key("SpaceBar"), key("Gamepad_FaceButton_Bottom")],
    down: [key("LeftControl"), key("Gamepad_FaceButton_Right")],
    boost: [key("LeftShift"), key("Gamepad_LeftTrigger")],
    stickX: key("Gamepad_LeftX"), stickY: key("Gamepad_LeftY"),
};

let jumpAction;             // undefined = not looked up yet, null = missing
let effectSystem;           // the same
let flying = null;          // while on: { character, movement, gravity (the value to put back) }
let padWasDown = false, keyboardWasDown = false;
let lastPadPress = -Infinity;
let lastTick = Date.now();
let lastEffect = 0;
let errors = 0;
let said = {};              // log lines that are written once

function once(id, text) {
    if (!said[id]) {
        said[id] = true;
        log(text);
    }
}

const anyDown = (pc, keys) => keys.some((k) => pc.IsInputKeyDown(k));
const alive = (object) => { try { return !!object && UE.KismetSystemLibrary.IsValid(object); } catch (e) { return false; } };

// True while the player can move: in a menu or a cutscene the game binds no jump key, and then L1 belongs to the menu.
function inGameplay(pc) {
    if (jumpAction === undefined)
        jumpAction = UE.Object.Load(JUMP_ACTION) || null;
    if (!jumpAction)
        return true;
    const input = UE.SubsystemBlueprintLibrary.GetLocalPlayerSubSystemFromPlayerController(pc, UE.EnhancedInputLocalPlayerSubsystem.StaticClass());
    return !!input && input.QueryKeysMappedToAction(jumpAction).Num() > 0;
}

// True in the tick in which the player asks to switch: L1 pressed twice within DOUBLE_TAP_MS, or the keyboard key once.
function toggled(pc, now) {
    const pad = pc.IsInputKeyDown(KEYS.togglePad), keyboard = pc.IsInputKeyDown(KEYS.toggleKeyboard);
    const padPressed = pad && !padWasDown, keyboardPressed = keyboard && !keyboardWasDown;
    padWasDown = pad;
    keyboardWasDown = keyboard;
    if (keyboardPressed)
        return true;
    if (!padPressed)
        return false;
    if (now - lastPadPress <= SETTINGS.DOUBLE_TAP_MS) {
        lastPadPress = -Infinity;
        return true;
    }
    lastPadPress = now;
    return false;
}

function switchOn(character) {
    const movement = character.CharacterMovement;
    flying = { character, movement, gravity: movement.GravityScale };
    movement.GravityScale = 0;
    log("on");
}

function switchOff(why) {
    if (!flying)
        return;
    try {
        if (alive(flying.movement))
            flying.movement.GravityScale = flying.gravity;
    }
    catch (e) {
        log("could not put the gravity back: " + e);
    }
    flying = null;
    log("off" + (why ? " (" + why + ")" : ""));
}

// The speed the player asks for, in the world, as a part of the top speed (length 0 to 1, more with up/down added).
function wanted(pc) {
    let forward = (pc.IsInputKeyDown(KEYS.forward) ? 1 : 0) - (pc.IsInputKeyDown(KEYS.back) ? 1 : 0);
    let right = (pc.IsInputKeyDown(KEYS.right) ? 1 : 0) - (pc.IsInputKeyDown(KEYS.left) ? 1 : 0);
    if (forward == 0 && right == 0) {
        const x = pc.GetInputAnalogKeyState(KEYS.stickX), y = pc.GetInputAnalogKeyState(KEYS.stickY);
        if (Math.hypot(x, y) >= STICK_DEAD_ZONE) {
            forward = y;
            right = x;
        }
    }
    const length = Math.hypot(forward, right);
    if (length > 1) {
        forward /= length;
        right /= length;
    }
    let x = 0, y = 0, z = 0;
    if (length > 0 && pc.PlayerCameraManager) {
        const rotation = pc.PlayerCameraManager.GetCameraRotation();
        const yaw = rotation.Yaw * Math.PI / 180, pitch = rotation.Pitch * Math.PI / 180;
        // Forward follows the camera, up and down too; right stays level.
        x = forward * Math.cos(pitch) * Math.cos(yaw) - right * Math.sin(yaw);
        y = forward * Math.cos(pitch) * Math.sin(yaw) + right * Math.cos(yaw);
        z = forward * Math.sin(pitch);
    }
    z += (anyDown(pc, KEYS.up) ? 1 : 0) - (anyDown(pc, KEYS.down) ? 1 : 0);
    return { x, y, z };
}

function puff(character, now) {
    if (!SETTINGS.EFFECT || effectSystem === null || now - lastEffect < SETTINGS.EFFECT_MS)
        return;
    lastEffect = now;
    try {
        if (effectSystem === undefined)
            effectSystem = UE.Object.Load(EFFECT_SYSTEM) || null;
        if (!effectSystem)
            return once("effect", "the dust effect is not in the game: flying without it");
        const at = character.K2_GetActorLocation();
        at.Z -= character.CapsuleComponent.GetScaledCapsuleHalfHeight();
        UE.NiagaraFunctionLibrary.SpawnSystemAtLocation(character, effectSystem, at, new UE.Rotator(0, 0, 0), new UE.Vector(1, 1, 1), true, true, 0, true);
    }
    catch (e) {
        effectSystem = null;
        log("the dust effect failed (" + e + "): flying without it");
    }
}

function fly(pc, character, seconds, now) {
    const want = wanted(pc);
    const top = SETTINGS.FLY_SPEED * (anyDown(pc, KEYS.boost) ? SETTINGS.BOOST : 1);
    const speed = character.GetVelocity();
    const blend = Math.min(1, SETTINGS.RESPONSE * seconds);
    const x = speed.X + (want.x * top - speed.X) * blend;
    const y = speed.Y + (want.y * top - speed.Y) * blend;
    const z = speed.Z + (want.z * top - speed.Z) * blend;
    flying.movement.GravityScale = 0; // the game may set it again, for example after an attack
    character.LaunchCharacter(new UE.Vector(x, y, z), true, true);
    if (want.x != 0 || want.y != 0 || want.z != 0)
        puff(character, now);
}

function tick() {
    const now = Date.now();
    const seconds = Math.min(0.1, (now - lastTick) / 1000);
    lastTick = now;
    const pc = UE.GameplayStatics.GetPlayerController(gameInstance, 0);
    const character = pc && UE.GameplayStatics.GetPlayerCharacter(gameInstance, 0);
    if (!character || !character.CharacterMovement) {
        switchOff("no player");
        return;
    }
    if (flying && flying.character !== character && UE.KismetSystemLibrary.GetPathName(flying.character) != UE.KismetSystemLibrary.GetPathName(character)) {
        flying = null; // a new player object (load, respawn) has its own gravity
        log("off (new player object)");
    }
    const gameplay = inGameplay(pc);
    if (toggled(pc, now) && gameplay) {
        if (flying)
            switchOff();
        else
            switchOn(character);
    }
    if (flying && gameplay)
        fly(pc, character, seconds, now);
}

const timer = setInterval(() => {
    try {
        tick();
        errors = 0;
    }
    catch (e) {
        // A level change can leave a dead player object for a moment: such errors pass. 300 in a row (5 seconds) do not.
        once("error", "tick failed: " + e);
        if (++errors == 30)
            switchOff("errors");
        if (errors >= 300) {
            clearInterval(timer);
            log("stopped after repeated errors: " + e);
        }
    }
}, TICK_MS);

log("started: press L1 twice (keyboard: " + SETTINGS.TOGGLE_KEYBOARD + ") to switch the jetpack on and off");

exports.stop = function () {
    clearInterval(timer);
    switchOff("mod stopped");
    log("stopped");
};
