// NG+ Phantom Edges for Phantom Blade Zero: a PBZModLoader mod.
//
// In New Game+ the game keeps your Phantom Edges but locks each one until you find it again. This mod unlocks the
// ones you already own.
//
// With Mods Menu (0.9.0 or later) the mod has a page in the Mods tab of the game's settings, with one switch:
// "Unlock Phantom Edges" Off / On. On unlocks them at once and again each time a save is loaded.
// Without Mods Menu: press K (gamepad: hold both sticks down, L3 + R3) while you play, or put the line Unlock=On
// into a file ngplus_edges.txt next to this main.js.
// The key asks before it unlocks. Press it again when everything is unlocked and it offers to undo what the mod
// unlocked. The loader's log has the details.
//
// How: the game stores for every Phantom Edge the playthrough in which you last got it, and lets you use only the
// ones of the current playthrough. The mod has the game's own "update to the current playthrough" function write
// that entry, as when you find the edge again; see unlock().

const SETTINGS = {
    KEY: "K",                   // keyboard key
    PAD: ["Gamepad_LeftThumbstick", "Gamepad_RightThumbstick"],   // held together
};

const UE = require("ue");
const puerts = require("puerts");

const MOD_ID = "ngplus-phantom-edges";   // the mod folder's name and the page's id in Mods Menu
const VERSION = "1.3";
const SETTINGS_FILE = "ngplus_edges.txt";
const UNDO_FILE = "ngplus_edges_undo.json";
const JUMP_ACTION = "/PBZInput/InputActions/IA_Jump.IA_Jump";
const TICK_MS = 50;
const FILE_EVERY = 40;      // ticks, so the settings file is read every 2 seconds

const log = (text) => console.log("[PBZMOD] [NG+ Edges] " + text);
const gameInstance = puerts.argv.getByName("GameInstance");
if (!gameInstance)
    throw new Error("NG+ Edges: the game instance is missing");

const key = (name) => { const k = new UE.Key(); k.KeyName = name; return k; };
const unlockKey = key(SETTINGS.KEY), padKeys = SETTINGS.PAD.map(key);

let jumpAction;             // undefined = not looked up yet, null = missing
let wasDown = true;         // true also means "not seen up yet"
let automatic = false;      // the switch: Unlock=On in the settings file
let autoDoneFor = "";       // the player object the automatic unlock already ran for
let ticks = 0;
let errorSaid = false;

// The page in Mods Menu's tab of the game's settings. Mods Menu starts before this mod and keeps its registry in
// globalThis.PBZModsMenu; the page saves its values as Key=Value lines in the file settingsPath(id) names.
let menuPage = false;
function registerMenuPage() {
    const menu = globalThis.PBZModsMenu;
    const usable = !!menu && typeof menu === "object" && !Array.isArray(menu) && typeof menu.push === "function"
        && typeof menu.settingsPath === "function" && menu.api && typeof menu.api.has === "function"
        && menu.api.has("settingsPath") && menu.api.has("store.saved");
    if (!usable)
        return log("Mods Menu is not running: no settings page (the key still works)");
    menu.push({
        id: MOD_ID, title: "NG+ Phantom Edges", file: SETTINGS_FILE, store: "saved", version: VERSION,
        description: {
            en: "In New Game+ the game locks the Phantom Edges you already own until you find them again. This unlocks them.",
            de: "In New Game+ sperrt das Spiel deine vorhandenen Phantomklingen, bis du sie erneut findest. Das hier schaltet sie frei.",
        },
        settings: [{
            key: "Unlock", type: "choice", default: "Off",
            label: { en: "Unlock Phantom Edges", de: "Phantomklingen freischalten" },
            options: [{ value: "Off", label: { en: "Off", de: "Aus" } }, { value: "On", label: { en: "On", de: "An" } }],
            help: {
                en: "On: every Phantom Edge you own is usable at once, and again each time you load a save. Off: the game's own rule. Edges unlocked before stay unlocked in that save.",
                de: "An: Jede Phantomklinge, die du besitzt, ist sofort nutzbar, auch nach jedem Laden. Aus: die Regel des Spiels. Bereits freigeschaltete Klingen bleiben in diesem Spielstand frei.",
            },
        }],
    });
    menuPage = typeof menu.settingsPath(MOD_ID) === "string";
    log(menuPage ? "settings page added to Mods Menu" : "Mods Menu gave the page no settings file");
}

function settingsPath() {
    if (menuPage) {
        const path = globalThis.PBZModsMenu.settingsPath(MOD_ID);
        if (typeof path === "string" && path)
            return path;
    }
    return UE.KismetSystemLibrary.ConvertToAbsolutePath(String(__dirname).replace(/[\\/]+$/, "") + "/" + SETTINGS_FILE);
}

// Reads the switch. A missing file means Off; a file that cannot be read right now keeps the value before.
function readSwitch() {
    const path = settingsPath();
    if (!UE.BlueprintPathsLibrary.FileExists(path)) {
        automatic = false;
        return;
    }
    const out = puerts.$ref("");
    if (!UE.EasyCsv.LoadStringFromLocalFile(path, out))
        return;
    const line = /^\s*Unlock\s*=\s*(\w+)/im.exec(puerts.$unref(out));
    const on = !!line && line[1].toLowerCase() == "on";
    if (on != automatic) {
        automatic = on;
        autoDoneFor = ""; // switched on: unlock now
        log("switch is " + (on ? "On" : "Off"));
    }
}

const toText = (string) => UE.KismetTextLibrary.Conv_StringToText(string);
const TITLE = "NG+ Phantom Edges";

// Tells the player what happened, in the game's own message box with an OK button.
function say(character, text) {
    log(text);
    try {
        UE.AsyncAction_ShowConfirmation.ShowConfirmationOk(character, toText(TITLE), toText(text)).Activate();
    }
    catch (e) {
        log("no message box: " + e);
    }
}

// Asks the player with the game's own Yes / No box and runs yes() after a Yes. While the box is open (at most
// 60 seconds, should its answer never arrive) the key does nothing.
let asking = null, askingUntil = 0;
function ask(character, text, yes) {
    log("asked: " + text);
    const action = UE.AsyncAction_ShowConfirmation.ShowConfirmationYesNo(character, toText(TITLE), toText(text));
    asking = action; // kept so the box's answer finds its listener
    askingUntil = Date.now() + 60000;
    action.OnResult.Add((result) => {
        asking = null;
        askingUntil = 0;
        log("answer: " + (result == UE.ECommonMessagingResult.Confirmed ? "yes" : "no"));
        if (result == UE.ECommonMessagingResult.Confirmed)
            setTimeout(() => { // after the box has closed
                try { yes(); } catch (e) { log("failed: " + e); }
            }, 300);
    });
    action.Activate();
}

// True while the player can move: in a menu or a cutscene the game binds no jump key.
function inGameplay(pc) {
    if (jumpAction === undefined)
        jumpAction = UE.Object.Load(JUMP_ACTION) || null;
    if (!jumpAction)
        return true;
    const input = UE.SubsystemBlueprintLibrary.GetLocalPlayerSubSystemFromPlayerController(pc, UE.EnhancedInputLocalPlayerSubsystem.StaticClass());
    return !!input && input.QueryKeysMappedToAction(jumpAction).Num() > 0;
}

// The undo record: what the mod changed, kept in a file next to this main.js so it survives a game restart:
// { cycle: the playthrough it was made in, edges: { id: [got in playthrough, +N] as they were before } }.
const undoPath = () => UE.KismetSystemLibrary.ConvertToAbsolutePath(String(__dirname).replace(/[\\/]+$/, "") + "/" + UNDO_FILE);

function loadUndo() {
    try {
        const path = undoPath();
        if (!UE.BlueprintPathsLibrary.FileExists(path))
            return null;
        const out = puerts.$ref("");
        if (!UE.EasyCsv.LoadStringFromLocalFile(path, out))
            return null;
        const record = JSON.parse(puerts.$unref(out));
        return record && typeof record.cycle == "number" && record.edges && Object.keys(record.edges).length > 0 ? record : null;
    }
    catch (e) {
        log("the undo record could not be read: " + e);
        return null;
    }
}

function saveUndo(record) {
    if (!UE.EasyCsv.SaveStringToFileWithFullPath(JSON.stringify(record), undoPath()))
        throw new Error("the undo record could not be written to " + undoPath());
}

// The player's Phantom Edges: all of them by id, and the ones last got in an earlier playthrough. null while the
// game's inventory is not there.
// The game lets you use an edge only when its entry "got in playthrough" is the current playthrough (its own
// IsWeaponLocked says nothing about this: game test of 1.0).
function edges(character) {
    const backpack = UE.SubsystemBlueprintLibrary.GetWorldSubsystem(character, UE.PBZBackPackSubsystem.StaticClass());
    const gameSystem = UE.SubsystemBlueprintLibrary.GetWorldSubsystem(character, UE.PBZGameSystem.StaticClass());
    if (!backpack || !gameSystem)
        return null;
    const cycle = gameSystem.GetCycleCount(); // 0 = first playthrough
    const all = new Map(), old = [];
    for (const [id, info] of backpack.ShaqiWeaponInfos) {
        all.set(String(id), info);
        if (info.AcquiredCycle < cycle)
            old.push({ id: String(id), info });
    }
    return { backpack, cycle, all, old };
}

const state = (id, info) => `${id}: level ${info.ShaChiWeaponLevel}, got in playthrough ${info.AcquiredCycle}, +${info.ReincarnationCount}`;

// Unlocks the edges of an earlier playthrough and returns the text for the player. The undo record is written
// first. The game's own update function sets the edge's +N as when you find it again (game test of 1.2: it leaves
// the playthrough entry alone), then the mod sets the entry.
function unlock(found) {
    const { backpack, cycle, old } = found;
    let record = loadUndo();
    if (!record || record.cycle != cycle)
        record = { cycle, edges: {} };
    for (const edge of old) {
        log("before: " + state(edge.id, edge.info));
        if (!(edge.id in record.edges))
            record.edges[edge.id] = [edge.info.AcquiredCycle, edge.info.ReincarnationCount];
    }
    saveUndo(record);
    const ids = UE.NewArray(UE.BuiltinName);
    for (const edge of old)
        ids.Add(edge.id);
    backpack.UpdateItemsReincarnationToCurrentCycle(ids);
    for (const edge of old) {
        edge.info.AcquiredCycle = cycle;
        log("after: " + state(edge.id, edge.info));
    }
    return `${old.length} Phantomklingen freigeschaltet.`;
}

// Puts back what unlock() changed, for the edges that are still as the mod left them, and returns the text.
function undo(found, record) {
    let restored = 0;
    for (const id of Object.keys(record.edges)) {
        const info = found.all.get(id);
        if (!info || info.AcquiredCycle != record.cycle)
            continue;
        log("before undo: " + state(id, info));
        info.AcquiredCycle = record.edges[id][0];
        info.ReincarnationCount = record.edges[id][1];
        log("after undo: " + state(id, info));
        restored++;
    }
    saveUndo({ cycle: record.cycle, edges: {} });
    return `Freischaltung von ${restored} Phantomklingen rückgängig gemacht.`;
}

// The key: asks before it unlocks; with nothing left to unlock, offers to undo what the mod unlocked.
function onKey() {
    const character = UE.GameplayStatics.GetPlayerCharacter(gameInstance, 0);
    const found = character && edges(character);
    if (!found)
        return log("the game's inventory is not ready");
    const record = loadUndo();
    const undoable = record && record.cycle == found.cycle ? Object.keys(record.edges).length : 0;
    log(`playthrough ${found.cycle}, ${found.all.size} Phantom Edges owned, ${found.old.length} from an earlier playthrough, ${undoable} in the undo record`);
    // Each answer looks at the game again: a save may have been loaded while the box was open.
    const again = (action) => () => {
        const now = UE.GameplayStatics.GetPlayerCharacter(gameInstance, 0);
        const fresh = now && edges(now);
        if (fresh)
            say(now, action(fresh));
    };
    if (found.old.length > 0)
        ask(character, `${found.old.length} Phantomklingen aus einem früheren Durchlauf jetzt freischalten?`,
            again((fresh) => fresh.old.length > 0 ? unlock(fresh) : "Es gibt nichts mehr freizuschalten."));
    else if (undoable > 0)
        ask(character, `Alle ${found.all.size} Phantomklingen sind nutzbar. Die Freischaltung von ${undoable} Klingen rückgängig machen?`,
            again((fresh) => {
                const current = loadUndo();
                return current && current.cycle == fresh.cycle ? undo(fresh, current) : "Es gibt nichts rückgängig zu machen.";
            }));
    else
        say(character, found.all.size == 0 ? "Du besitzt keine Phantomklingen." : `Alle ${found.all.size} Phantomklingen sind bereits nutzbar.`);
}

function tick() {
    if (ticks++ % FILE_EVERY == 0)
        readSwitch();
    const pc = UE.GameplayStatics.GetPlayerController(gameInstance, 0);
    const character = pc && UE.GameplayStatics.GetPlayerCharacter(gameInstance, 0);
    if (!character)
        return;
    const down = pc.IsInputKeyDown(unlockKey) || padKeys.every((k) => pc.IsInputKeyDown(k));
    const pressed = down && !wasDown;
    wasDown = down;
    if (asking && Date.now() < askingUntil)
        return;
    if (!inGameplay(pc))
        return;
    if (pressed) {
        onKey();
        return;
    }
    // The switch: unlocks without asking, once per loaded save.
    if (automatic) {
        const who = UE.KismetSystemLibrary.GetPathName(character);
        if (who != autoDoneFor) {
            autoDoneFor = who;
            const found = edges(character);
            if (found && found.old.length > 0)
                say(character, unlock(found));
        }
    }
}

try {
    registerMenuPage();
}
catch (e) {
    log("no Mods Menu page: " + e);
}

const timer = setInterval(() => {
    try {
        tick();
    }
    catch (e) {
        if (!errorSaid) {
            errorSaid = true;
            log("failed: " + e);
        }
    }
}, TICK_MS);

log(`started: switch on the Mods Menu page, or press ${SETTINGS.KEY} (gamepad: L3 + R3)`);

exports.stop = function () {
    clearInterval(timer);
    log("stopped");
};
