// Der Maßbrecher: an own weapon for Phantom Blade Zero, as a PBZModLoader mod.
//
// A Bavarian blade that works like a programmer's day. Whatever weapon you hold becomes it while the mod is on
// (press B to switch it off and on):
//   Commits      every hit you land is a commit: +2.5 % attack each, up to 16. The row of squares shows them.
//   Abgfangt     a perfect parry or a perfect dodge: +2 commits and a little health ("Passt scho!").
//   Rollback     a hit you take rolls back half of your commits ("Segfault! Sakradi!").
//   O'zapft is!  at 16 commits the release goes out: 12 seconds of +60 % attack, the blade burns white and blue.
//                Then it is Feierabend and the commits start at 0.
// The weapon glows white and blue (a light on it), brighter with every commit.
//
// Press N twice to take the Maßbrecher into your inventory as a weapon of its own: it stands in the weapon menu with
// its name and text, and has the Armeebrecher's moves, levels and, for now, model. N twice again takes it out.
// With the weapon in your inventory its id is in your save game: keep this mod installed, or take the weapon out
// before you remove the mod.
//
// How: the mod listens to the game's own events on the player (hits landed, hits taken, perfect parries), keeps
// the count, and writes the player's attack value: its own value times what the commits give.
//
// This is the first version. It does not know yet which of the game's events is "I landed a hit": it takes the
// events whose names look like it (see kindOf) and writes every event it sees into the loader's log once, so
// the names can be made exact.

const SETTINGS = {
    KEY: "B",               // switches the weapon off and on
    MAX_COMMITS: 16,
    ATTACK_PER_COMMIT: 0.025,
    PARRY_COMMITS: 2,
    PARRY_HEAL: 0.02,       // of your full health
    RELEASE_SECONDS: 12,
    RELEASE_ATTACK: 0.6,    // +60 % while the release runs
    LIGHT: false,           // the white and blue glow on the weapon. Off: a light this near the weapon bleaches it and the figure (game test)
    HUD: false,             // the row of commits on the screen
};

const UE = require("ue");
const puerts = require("puerts");

const NAME = "Maßbrecher";
const TIP_CLASS = "/Game/PBZContent/UI/InGame/SwitchUI/WB_TipsText.WB_TipsText_C";
const FONT_FOLDER = "/Game/PBZContent/UI/Fonts";
const JUMP_ACTION = "/PBZInput/InputActions/IA_Jump.IA_Jump";
const WEAPON_TABLE = "/Game/PBZContent/DataTable/UI/DT_WeaponData.DT_WeaponData";    // the main weapons (game test: 33 rows of WeaponData)
const EVENT_ROOT = "GameplayEvent";     // listening to the root gives every event below it
const TICK_MS = 100;
const HIT_GAP_MS = 150;                 // events of one blow come in a burst: they count once
const SAY_GAP_MS = 2500;                // between two of the weapon's remarks
const BLUE = () => new UE.LinearColor(0.25, 0.55, 1, 1), WHITE = () => new UE.LinearColor(0.95, 0.97, 1, 1);

const log = (text) => console.log("[PBZMOD] [Massbrecher] " + text);
const gameInstance = puerts.argv.getByName("GameInstance");
if (!gameInstance)
    throw new Error("Massbrecher: the game instance is missing");

const key = (name) => { const k = new UE.Key(); k.KeyName = name; return k; };
const toggleKey = key(SETTINGS.KEY), addKey = key("N"), variantKey = key("V");
const toText = (string) => UE.KismetTextLibrary.Conv_StringToText(string);
const player = () => UE.GameplayStatics.GetPlayerCharacter(gameInstance, 0);
const valid = (object) => { try { return !!object && UE.KismetSystemLibrary.IsValid(object); } catch (e) { return false; } };
const attempt = (what, action) => { try { return action(); } catch (e) { log(what + " failed: " + e); } };
const attribute = (character, name) => character.AttributeSetBase[name].CurrentValue;
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// Writes an attribute's base and current value. The struct is written back as a whole: a read gives a copy.
function setAttribute(character, name, value) {
    const set = character.AttributeSetBase;
    const data = set[name];
    data.BaseValue = value;
    data.CurrentValue = value;
    set[name] = data;
}

// What the mod says in answer to its own keys, in Bavarian. Nothing is said in a fight (the user's wish).
const SAYS = {
    askTake: ["Nomoi N drucka: Maßbrecher ins Inventar legen."],
    taken: ["Der Maßbrecher liegt im Inventar. Schau bei de Hauptwaffen."],
    askDrop: ["Nomoi N drucka: Maßbrecher wieder aus'm Inventar nehma."],
    dropped: ["Der Maßbrecher is wieder aus'm Inventar."],
    noRow: ["Des Spui nimmt de Waffn ned o. Schau ins Log."],
};

let on = true;
let state = null;       // for the player object in use: see bind()
let hud = null;         // { host, row, line }
let tip = null;         // the remark on screen
let wasDown = true;
let lastSaid = 0;
let jumpAction;
let screenFont;
const seen = {};        // event names that were logged
let errorSaid = false;

// ---------------------------------------------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------------------------------------------

function inGameplay(pc) {
    if (jumpAction === undefined)
        jumpAction = UE.Object.Load(JUMP_ACTION) || null;
    if (!jumpAction)
        return true;
    const input = UE.SubsystemBlueprintLibrary.GetLocalPlayerSubSystemFromPlayerController(pc, UE.EnhancedInputLocalPlayerSubsystem.StaticClass());
    return !!input && input.QueryKeysMappedToAction(jumpAction).Num() > 0;
}

// One of the weapon's remarks, in the game's own tip strip. Not more often than every SAY_GAP_MS, unless forced.
function say(kind, force) {
    const now = Date.now();
    if (!force && now - lastSaid < SAY_GAP_MS)
        return;
    lastSaid = now;
    const text = pick(SAYS[kind]);
    attempt("remark", () => {
        if (tip) {
            clearTimeout(tip.timer);
            if (valid(tip.widget))
                tip.widget.RemoveFromParent();
            tip = null;
        }
        const pc = UE.GameplayStatics.GetPlayerController(gameInstance, 0);
        const widget = UE.WidgetBlueprintLibrary.Create(player(), UE.WidgetBlueprintGeneratedClass.Load(TIP_CLASS), pc);
        widget.AddToViewport(50);
        widget.SetText(toText(text));
        attempt("remark fade in", () => widget.PlayAnimation(widget.FadeIn, 0, 1, 0, 1, false));
        const mine = { widget, timer: null };
        mine.timer = setTimeout(() => {
            if (valid(widget))
                widget.RemoveFromParent();
            if (tip === mine)
                tip = null;
        }, 2200);
        tip = mine;
    });
}

function gameFont() {
    if (screenFont !== undefined)
        return screenFont;
    screenFont = null;
    attempt("font", () => {
        const found = puerts.$ref(UE.NewArray(UE.AssetData));
        UE.AssetRegistryHelpers.GetAssetRegistry().GetAssetsByPath(FONT_FOLDER, found, true, false);
        const assets = puerts.$unref(found), fonts = [];
        for (let i = 0; i < assets.Num(); i++)
            if (String(assets.Get(i).AssetClassPath.AssetName) == "Font")
                fonts.push(`${assets.Get(i).PackageName}.${assets.Get(i).AssetName}`);
        const chosen = fonts.find((f) => /german|vollkorn/i.test(f)) || fonts[0];
        screenFont = chosen ? UE.Object.Load(chosen) || null : null;
    });
    return screenFont;
}

function textBlock(canvas, x, y, size, color) {
    const block = UE.NewObject(UE.TextBlock.StaticClass());
    const font = block.Font;
    font.Size = size;
    if (gameFont())
        font.FontObject = gameFont();
    block.SetFont(font);
    const tone = new UE.SlateColor();
    tone.SpecifiedColor = color;
    block.SetColorAndOpacity(tone);
    const slot = canvas.AddChildToCanvas(block);
    slot.SetPosition(new UE.Vector2D(x, y));
    slot.SetAutoSize(true);
    return block;
}

// The row of commits, above the player's health bar. Laid out on 1920 x 1080, centred on the screen.
function showHud() {
    if (!SETTINGS.HUD || (hud && valid(hud.host)))
        return;
    hud = attempt("commit row", () => {
        const root = UE.NewObject(UE.CanvasPanel.StaticClass()), board = UE.NewObject(UE.CanvasPanel.StaticClass());
        const centre = new UE.Anchors();
        centre.Minimum = new UE.Vector2D(0.5, 0.5);
        centre.Maximum = new UE.Vector2D(0.5, 0.5);
        const slot = root.AddChildToCanvas(board);
        slot.SetAnchors(centre);
        slot.SetAlignment(new UE.Vector2D(0.5, 0.5));
        slot.SetPosition(new UE.Vector2D(0, 0));
        slot.SetSize(new UE.Vector2D(1920, 1080));
        const row = textBlock(board, 392, 872, 15, BLUE()), line = textBlock(board, 392, 894, 13, WHITE());
        const pc = UE.GameplayStatics.GetPlayerController(gameInstance, 0);
        // Widgets made from script show only inside a user widget of the game: an empty one holds them.
        const host = UE.WidgetBlueprintLibrary.Create(player(), UE.WidgetBlueprintGeneratedClass.Load(TIP_CLASS), pc);
        host.WidgetTree.RootWidget = root;
        host.AddToViewport(20);
        host.SetRenderOpacity(1);
        host.SetColorAndOpacity(new UE.LinearColor(1, 1, 1, 1));
        host.SetVisibility(UE.ESlateVisibility.HitTestInvisible);
        return { host, row, line, text: "" };
    }) || null;
}

function hideHud() {
    if (hud && valid(hud.host))
        hud.host.RemoveFromParent();
    hud = null;
}

function drawHud(visible) {
    if (!hud || !valid(hud.host) || !state)
        return;
    hud.host.SetVisibility(visible ? UE.ESlateVisibility.HitTestInvisible : UE.ESlateVisibility.Collapsed);
    const releasing = Date.now() < state.releaseUntil;
    const squares = "■".repeat(state.commits) + "□".repeat(SETTINGS.MAX_COMMITS - state.commits);
    const plus = Math.round(100 * (multiplier() - 1));
    const line = releasing ? `O'zapft is!   Release läuft noch ${Math.ceil((state.releaseUntil - Date.now()) / 1000)} s   ·   +${plus} % Angriff`
        : `${NAME}   ·   ${state.commits} Commits   ·   +${plus} % Angriff`;
    const text = squares + line;
    if (text == hud.text)
        return;
    hud.text = text;
    hud.row.SetText(toText(releasing ? "■".repeat(SETTINGS.MAX_COMMITS) : squares));
    hud.line.SetText(toText(line));
}

// ---------------------------------------------------------------------------------------------------------------
// The weapon
// ---------------------------------------------------------------------------------------------------------------

// What the commits give: the factor on the player's attack.
function multiplier() {
    if (!state || !on)
        return 1;
    if (Date.now() < state.releaseUntil)
        return 1 + SETTINGS.MAX_COMMITS * SETTINGS.ATTACK_PER_COMMIT + SETTINGS.RELEASE_ATTACK;
    return 1 + state.commits * SETTINGS.ATTACK_PER_COMMIT;
}

// What an event of the game means for the weapon: "parry", "taken" (a hit the player took), "landed" (a hit the
// player dealt) or null. The names are the ones the game sent to the player in a fight (game test). Others with
// "Perfect" in them come with every press of the block key and are not parries.
const EVENTS = {
    "GameplayEvent.Actor.Hit.Attacker": "landed",
    "GameplayEvent.Damage.Taken": "taken",
    "GameplayEvent.Ability.Action.Deflect.Defender.Perfect": "parry",
    "GameplayEvent.Ability.Action.PerfectDodge.Defender": "parry",  // a perfect dodge catches the error as well
};
const kindOf = (name) => EVENTS[name] || null;

function commit(count) {
    const before = state.commits;
    state.commits = Math.min(SETTINGS.MAX_COMMITS, state.commits + count);
    if (state.commits >= SETTINGS.MAX_COMMITS && Date.now() >= state.releaseUntil) {
        state.releaseUntil = Date.now() + SETTINGS.RELEASE_SECONDS * 1000;
        state.releasing = true;
        log("release");
    }
}

function onEvent(payload) {
    const name = String(payload && payload.EventTag ? payload.EventTag.TagName : "");
    const kind = kindOf(name);
    if (!seen[name] && Object.keys(seen).length < 150) {
        seen[name] = true;
        log(`event on the player: ${name}${kind ? " -> " + kind : ""}`);
    }
    if (!on || !state || !kind)
        return;
    const now = Date.now();
    if (now - (state.last[kind] || 0) < HIT_GAP_MS)
        return;
    state.last[kind] = now;
    if (kind == "landed" && now >= state.releaseUntil)
        commit(1);
    else if (kind == "parry") {
        if (now >= state.releaseUntil)
            commit(SETTINGS.PARRY_COMMITS);
        attempt("parry heal", () => {
            const character = player(), full = attribute(character, "Health_Max");
            const data = character.AttributeSetBase.Health;
            data.CurrentValue = data.BaseValue = Math.min(full, data.CurrentValue + SETTINGS.PARRY_HEAL * full);
            const set = character.AttributeSetBase;
            set.Health = data;
        });
    }
    else if (kind == "taken" && now >= state.releaseUntil && state.commits > 0) {
        state.commits = Math.floor(state.commits / 2);
    }
}

// The glow: a white and blue light on the weapon in the player's hand, or on the player when no weapon actor is found.
function addLight(character) {
    if (!SETTINGS.LIGHT)
        return null;
    return attempt("light", () => {
        const found = puerts.$ref(UE.NewArray(UE.Actor));
        character.GetAttachedActors(found, true, true);
        const attached = puerts.$unref(found), names = [];
        let weapon = null;
        for (let i = 0; i < attached.Num(); i++) {
            const actor = attached.Get(i), name = String(UE.KismetSystemLibrary.GetObjectName(actor.GetClass()));
            names.push(name);
            if (!weapon && /weapon/i.test(name) && !actor.bHidden)
                weapon = actor;
        }
        const owner = weapon || character, ownerName = String(UE.KismetSystemLibrary.GetObjectName(owner));
        if (state.light && valid(state.light) && state.lightOn == ownerName)
            return state.light;     // the light is on the weapon in hand already
        if (valid(state.light))
            state.light.K2_DestroyComponent(state.light);
        state.lightOn = ownerName;
        log(`attached to the player: ${names.join(", ") || "nothing"}; the light goes on ${weapon ? UE.KismetSystemLibrary.GetObjectName(weapon.GetClass()) : "the player"}`);
        const light = owner.AddComponentByClass(UE.PointLightComponent.StaticClass(), false,
            UE.KismetMathLibrary.MakeTransform(new UE.Vector(0, 0, weapon ? 0 : 60), new UE.Rotator(0, 0, 0), new UE.Vector(1, 1, 1)), false);
        light.SetCastShadows(false);
        light.SetAttenuationRadius(260);
        light.SetIntensityUnits(UE.ELightUnits.Candelas);
        return light;
    }) || null;
}

function drawLight() {
    if (!state || !valid(state.light))
        return;
    attempt("light level", () => {
        const releasing = Date.now() < state.releaseUntil, pulse = 0.5 + 0.5 * Math.sin(Date.now() / (releasing ? 90 : 600));
        // White and blue take turns: slowly as the commits grow, fast while the release runs.
        const blue = releasing ? pulse : 0.6 + 0.4 * pulse;
        state.light.SetLightColor(new UE.LinearColor(1 - 0.75 * blue, 1 - 0.45 * blue, 1, 1), true);
        state.light.SetIntensity(!on ? 0 : releasing ? 60 : 2.5 + 1.5 * state.commits);
    });
}

// Reads the game's weapons into weapons.txt beside this file, once: the tables that hold them, the weapons the
// player owns and every row of the main weapon table (id, name, kind, levels, the asset with its moves, its
// meshes). Nothing is changed. It is the groundwork for adding the Maßbrecher as a weapon of its own: a copy of a
// row under a new id (DataTableFL.AddDataTableRow), handed to the player with the backpack's AddWeaponItem.
let probed = false;
function probeWeapons(character) {
    if (probed)
        return;
    probed = true;
    attempt("weapon probe", () => {
        const lines = [];
        const text = (loc) => attempt("name", () => UE.KismetTextLibrary.Conv_TextToString(UE.EventPipelineManager.Conv_LocTextToText(loc))) || "?";
        const soft = (reference) => attempt("path", () => String(UE.KismetSystemLibrary.Conv_SoftObjectReferenceToString(reference))) || "?";
        const backpack = UE.SubsystemBlueprintLibrary.GetWorldSubsystem(character, UE.PBZBackPackSubsystem.StaticClass());
        const owned = backpack.GetAllNormalWeapons(), ownedIds = [];
        for (let i = 0; i < owned.Num(); i++)
            ownedIds.push(String(owned.Get(i)));
        lines.push(`in hand: ${backpack.CurrentMainWeaponID}`);
        lines.push(`owned main weapons: ${ownedIds.join(", ")}`);
        lines.push("");
        lines.push("data tables with weapon in their name:");
        attempt("table list", () => {
            const found = puerts.$ref(UE.NewArray(UE.AssetData));
            UE.AssetRegistryHelpers.GetAssetRegistry().GetAssetsByPath("/Game/PBZContent", found, true, false);
            const assets = puerts.$unref(found);
            for (let i = 0; i < assets.Num(); i++) {
                const asset = assets.Get(i);
                if (String(asset.AssetClassPath.AssetName) != "DataTable" || !/weapon/i.test(String(asset.AssetName)))
                    continue;
                const path = `${asset.PackageName}.${asset.AssetName}`;
                const table = UE.DataTable.Load(path);
                const rows = puerts.$ref(UE.NewArray(UE.BuiltinName));
                if (table)
                    UE.DataTableFunctionLibrary.GetDataTableRowNames(table, rows);
                const struct = table ? UE.KismetSystemLibrary.GetObjectName(UE.DataTableFunctionLibrary.GetDataTableRowStruct(table)) : "not loaded";
                lines.push(`  ${path} | rows of ${struct} | ${table ? puerts.$unref(rows).Num() : 0} rows`);
            }
        });
        lines.push("");
        lines.push("main weapon table (id | name | kind | levels | attack of the levels | moves | meshes | icon):");
        const table = UE.DataTable.Load(WEAPON_TABLE), rowNames = puerts.$ref(UE.NewArray(UE.BuiltinName));
        UE.DataTableFunctionLibrary.GetDataTableRowNames(table, rowNames);
        const names = puerts.$unref(rowNames);
        for (let i = 0; i < names.Num(); i++) {
            const row = new UE.WeaponData();
            if (!UE.DataTableFunctionLibrary.Generic_GetDataTableRowFromName(table, names.Get(i), row)) {
                lines.push(`  row ${names.Get(i)}: not read`);
                continue;
            }
            const id = `${names.Get(i)} (item ${row.ItemId})`;
            const attacks = [], meshes = [];
            for (let level = 0; level < row.WeaponUpLevelDatas.Num(); level++)
                attacks.push(row.WeaponUpLevelDatas.Get(level).AttackMultipliers);
            for (let m = 0; m < row.WeaponMesh.Num(); m++)
                meshes.push(soft(row.WeaponMesh.Get(m)));
            lines.push(`  ${id} | ${text(row.WeaponName)} | kind ${row.WeaponType} | grade ${row.WeaponLevel} | ${row.WeaponUpLevelDatas.Num()} levels | ${attacks.join(" ")} | ${soft(row.WeaponConfig)} | ${meshes.join(", ")} | ${soft(row.Icon)} | ${soft(row.RenderIcon)}`);
        }
        const path = UE.KismetSystemLibrary.ConvertToAbsolutePath(String(__dirname).replace(/[\\/]+$/, "") + "/weapons.txt");
        UE.EasyCsv.SaveStringToFileWithFullPath(lines.join(String.fromCharCode(10)), path);
        log(`weapon probe: ${lines.length} lines written to ${path}`);
    });
}

// Takes the weapon up for the player object that is there now.
function bind(character) {
    state = { who: UE.KismetSystemLibrary.GetPathName(character), commits: 0, releaseUntil: 0, releasing: false, last: {},
        base: attribute(character, "Attack"), lastSet: null, light: null, listener: null };
    log(`bound to the player: attack ${state.base}`);
    state.listener = attempt("listener", () => {
        const tag = new UE.GameplayTag();
        tag.TagName = EVENT_ROOT;
        const task = UE.AbilityAsync_WaitGameplayEvent.WaitGameplayEventToActor(character, tag, false, false);
        const received = (payload) => attempt("event", () => onEvent(payload));
        task.EventReceived.Add(received);
        task.Activate();
        return { task, received };
    }) || null;
    state.light = addLight(character);
    probeWeapons(character);
}

// Lays the weapon down: the player's own attack value back, the light and the listener away.
function unbind() {
    if (!state)
        return;
    const old = state;
    state = null;
    attempt("unbind", () => {
        const character = player();
        if (character && UE.KismetSystemLibrary.GetPathName(character) == old.who && old.lastSet !== null)
            setAttribute(character, "Attack", old.base);
        if (old.listener) {
            old.listener.task.EventReceived.Remove(old.listener.received);
            old.listener.task.EndAction();
        }
        if (valid(old.light))
            old.light.K2_DestroyComponent(old.light);
    });
}

// The player's attack: its own value times what the commits give. The player's own value is read only while the
// weapon gives nothing (factor 1), so that a boosted value is never taken for the player's own.
function applyAttack(character) {
    const now = attribute(character, "Attack"), factor = multiplier();
    if (factor == 1) {
        if (state.lastSet !== null) {
            setAttribute(character, "Attack", state.base);
            state.lastSet = null;
        }
        else
            state.base = now;   // the game's own value, which changes with the weapon in hand
        return;
    }
    const want = state.base * factor;
    if (Math.abs(now - want) > 0.01) {
        setAttribute(character, "Attack", want);
        state.lastSet = want;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// The Maßbrecher as a weapon of its own in the game's weapon menu
// ---------------------------------------------------------------------------------------------------------------

// The game keeps its main weapons as rows of a table. The Maßbrecher is a copy of the Armeebrecher's row under an
// id of its own, with its own name and texts; its levels, costs, moves and (for now) its model are the
// Armeebrecher's. The row lives in memory only: the mod adds it at every game start. The weapon itself, once the
// player has taken it (key N), is in the save game under its id.
const NEW_ID = "Massbrecher";
const BASE_MOVES = "/PoJun/Weapon_Hun_PoJun";   // the row with this move set is the one copied: Armeebrecher
const WEAPON_TEXTS = {
    WeaponName: "Maßbrecher",
    Simple: "A Masskrug am Stiel. Kompiliert ohne Warnungen.",
    ShortIntroduction: "A Masskrug am Stiel. Kompiliert ohne Warnungen.",
    EquipDescription: "Gschmiedet z'Minga, wo ma Bugs no mit da Hand derschlagt. Jeder Treffer is a Commit, "
        + "a perfekte Parade bringt glei zwoa, und bei sechzehn Commits hoaßt's: O'zapft is!",
};
let rowState = "";      // "": not tried yet, "added", "failed"
let rowChecked = 0;

const softPath = (reference) => attempt("path", () => String(UE.KismetSystemLibrary.Conv_SoftObjectReferenceToString(reference))) || "";

// The item ids of the table's rows, in the rows' order.
function weaponIds(table) {
    const column = UE.DataTableFunctionLibrary.GetDataTableColumnAsString(table, "ItemId"), ids = [];
    for (let i = 0; i < column.Num(); i++)
        ids.push(String(column.Get(i)));
    return ids;
}

// Puts the Maßbrecher's row into the weapon table when it is not there. true: the table has a row whose item id
// is the Maßbrecher's. Nothing else is done while that cannot be confirmed.
function ensureRow() {
    if (rowState)
        return rowState == "added";
    rowState = "failed";
    attempt("weapon row", () => {
        const table = UE.DataTable.Load(WEAPON_TABLE);
        const before = weaponIds(table);
        if (before.includes(NEW_ID)) {
            rowState = "added";
            return;
        }
        log(`weapon table: ${before.length} rows, item ids ${before.join(", ")}`);
        const rowNames = puerts.$ref(UE.NewArray(UE.BuiltinName));
        UE.DataTableFunctionLibrary.GetDataTableRowNames(table, rowNames);
        const names = puerts.$unref(rowNames);
        let row = null, baseName = "";
        for (let i = 0; i < names.Num() && !row; i++) {
            const one = new UE.WeaponData();
            if (UE.DataTableFunctionLibrary.Generic_GetDataTableRowFromName(table, names.Get(i), one) && softPath(one.WeaponConfig).includes(BASE_MOVES)) {
                row = one;
                baseName = String(names.Get(i));
            }
        }
        if (!row)
            return log("weapon row: the Armeebrecher's row was not found");
        log(`weapon row: copying ${baseName}, whose item id reads as ${row.ItemId}`);
        row.ItemId = NEW_ID;
        for (const field of Object.keys(WEAPON_TEXTS)) attempt("weapon text " + field, () => {
            // A text of the game is a key into its translations with a ready text beside it: without a key the ready text shows.
            const loc = row[field];
            loc.Namespace = "";
            loc.Key = "";
            loc.ValueCache = toText(WEAPON_TEXTS[field]);
            row[field] = loc;
        });
        const added = UE.DataTableFL.AddDataTableRow(table, row, NEW_ID, false);
        const after = weaponIds(table);
        log(`weapon row: added ${added}, the table has ${after.length} rows, the new row's item id reads as ${after[after.length - 1]}`);
        if (after.includes(NEW_ID))
            rowState = "added";
        else
            log("weapon row: no row carries the Maßbrecher's id, so the weapon is not offered");
        attempt("weapon name check", () => {
            const check = new UE.WeaponData();
            if (UE.DataTableFunctionLibrary.Generic_GetDataTableRowFromName(table, NEW_ID, check))
                log(`weapon row: its name shows as "${UE.KismetTextLibrary.Conv_TextToString(UE.EventPipelineManager.Conv_LocTextToText(check.WeaponName))}"`);
        });
    });
    return rowState == "added";
}

// Key N, pressed twice: takes the Maßbrecher into the inventory, or, when it is there, out of it again.
let askedAt = 0, addWasDown = true;
function weaponKey(pc, character) {
    const down = pc.IsInputKeyDown(addKey);
    const pressed = down && !addWasDown;
    addWasDown = down;
    if (!pressed)
        return;
    if (!ensureRow())
        return say("noRow", true);
    attempt("weapon key", () => {
        const backpack = UE.SubsystemBlueprintLibrary.GetWorldSubsystem(character, UE.PBZBackPackSubsystem.StaticClass());
        const owned = backpack.GetAllNormalWeapons();
        let has = false;
        for (let i = 0; i < owned.Num(); i++)
            has = has || String(owned.Get(i)) == NEW_ID;
        if (Date.now() - askedAt > 4000) {
            askedAt = Date.now();
            return say(has ? "askDrop" : "askTake", true);
        }
        askedAt = 0;
        if (has) {
            backpack.DisposeWeapon(NEW_ID, true);
            log("weapon: taken out of the inventory");
            say("dropped", true);
        }
        else {
            backpack.AddWeaponItem(NEW_ID, true, true, false, false);
            log("weapon: put into the inventory");
            say("taken", true);
        }
    });
}

// ---------------------------------------------------------------------------------------------------------------
// The Masskrug hammer in the hand
// ---------------------------------------------------------------------------------------------------------------

// While one of MODEL_FOR is the weapon in hand, the hammer stands in for its model: the mod builds the hammer's
// mesh from data/hammer.json (written by model/export_for_mod.py) as a procedural mesh on the game's weapon
// actor and hides the weapon's own meshes. The moves stay the weapon's. Size and direction are taken from the
// weapon it replaces: the hammer points where that weapon's body lies from the hand, and is as long.
const MODEL_FOR = ["PoJun", NEW_ID];
const MODEL = {
    SCALE: 1.0,     // on top of the fitted size
    ROLL: 0,        // degrees about the hammer's own length, to turn the Masskrug's face
    SLIDE: 0,       // cm along the hammer: moves the grip point toward the head (+) or the end (-)
};
// What the hammer wears, to find out by eye what this game's weapon material does with the hammer's pictures:
// key V goes to the next variant, the tip strip names it, the hammer is built anew with it.
//   textures: which of the hammer's pictures go into the weapon's material; dry: the material's wetness set to 0;
//   engine: the engine's own plain material in place of the weapon's.
const VARIANTS = [
    { name: "A: Material des Armeebrechers, unverändert", textures: [], dry: false },
    { name: "B: unverändert, nur trocken gestellt", textures: [], dry: true },
    { name: "C: nur das Farbbild", textures: ["basecolor"], dry: false },
    { name: "D: Farbbild, trocken gestellt", textures: ["basecolor"], dry: true },
    { name: "E: Farbbild + Normalen", textures: ["basecolor", "normal"], dry: false },
    { name: "F: Farbbild + Rauheit", textures: ["basecolor", "rm"], dry: false },
    { name: "G: alle drei Bilder", textures: ["basecolor", "normal", "rm"], dry: false },
    { name: "H: Standardmaterial der Engine", textures: [], dry: false, engine: true },
    // Game test of A to H: the hammer is there with the weapon's material unchanged and with the engine's plain
    // material, and gone as soon as its own colour picture is in the weapon's material. The mod's pictures are
    // ordinary textures; the weapon's own may be virtual ones, for which the material's input is made.
    { name: "I: Engine-Material mit Farbbild, ohne Licht und Schatten", textures: [], dry: false, flat: true },
    { name: "J: Material einer anderen Waffe (ohne virtuelle Textur) mit Farbbild", textures: ["basecolor"], dry: false, donor: true },
];
const ENGINE_MATERIAL = "/Engine/EngineMaterials/DefaultMaterial.DefaultMaterial";
// The engine's material for a screen widget in the world: it shows one picture ("SlateUI") as it is, unlit.
const FLAT_MATERIALS = ["/Engine/EngineMaterials/Widget3DPassThrough_Opaque_OneSided.Widget3DPassThrough_Opaque_OneSided",
    "/Engine/EngineMaterials/Widget3DPassThrough_Opaque.Widget3DPassThrough_Opaque", "/Engine/EngineMaterials/Widget3DPassThrough.Widget3DPassThrough"];
const FLAT_LEVEL = 0.55;    // how bright the unlit hammer is: it does not darken with the scene
let variant = 8;        // I: the one that shows the hammer in its own colours (game test)
let variantWasDown = true;
let hammerData;         // undefined: not read yet, null: not readable
let hammerTextures;     // { basecolor, normal, rm }
let models = [];        // the hammers shown: one { weapon, mesh, hidden (the components made invisible) } for each Armeebrecher actor
let weaponClass = null; // the class of the Armeebrecher's actor, once one has been seen
let modelChecked = 0;

const dataFile = (name) => UE.KismetSystemLibrary.ConvertToAbsolutePath(String(__dirname).replace(/[\\/]+$/, "") + "/data/" + name);

function readHammer(pc) {
    if (hammerData !== undefined)
        return hammerData;
    hammerData = null;
    attempt("hammer data", () => {
        const out = puerts.$ref("");
        if (!UE.EasyCsv.LoadStringFromLocalFile(dataFile("hammer.json"), out))
            return log("hammer.json not read");
        hammerData = JSON.parse(puerts.$unref(out));
        hammerTextures = {};
        for (const kind of ["basecolor", "normal", "rm"]) {
            const texture = UE.KismetRenderingLibrary.ImportFileAsTexture2D(pc, dataFile(`hammer_${kind}.png`));
            hammerTextures[kind] = texture || null;
        }
        log(`hammer: ${hammerData.points.length / 3} points, ${hammerData.triangles.length / 3} triangles, ${hammerData.length} cm; textures `
            + Object.keys(hammerTextures).map((kind) => `${kind} ${hammerTextures[kind] ? "read" : "missing"}`).join(", "));
    });
    return hammerData;
}

// The texture inputs of a material and of the materials it is made from: name -> the texture it has now.
function textureInputs(material) {
    const inputs = [];
    for (let depth = 0; material && depth < 5; depth++) {
        const own = attempt("material inputs", () => {
            const values = material.TextureParameterValues;
            for (let i = 0; values && i < values.Num(); i++) {
                const value = values.Get(i), name = String(value.ParameterInfo.Name);
                if (!inputs.some((input) => input.name == name))
                    inputs.push({ name, info: value.ParameterInfo, layer: `${value.ParameterInfo.Association}/${value.ParameterInfo.Index}`,
                        texture: value.ParameterValue ? String(UE.KismetSystemLibrary.GetObjectName(value.ParameterValue)) : "none",
                        virtual: !!value.ParameterValue && attempt("virtual", () => !!value.ParameterValue.VirtualTextureStreaming) });
            }
            return material.Parent;
        });
        material = own || null;
    }
    return inputs;
}

function showModel(pc, weapon) {
    const data = readHammer(pc);
    if (!data)
        return null;
    return attempt("hammer model", () => {
        // The weapon's own visible parts, and where its body lies seen from the actor's origin (the hand).
        const parts = weapon.K2_GetComponentsByClass(UE.MeshComponent.StaticClass()), hidden = [], names = [];
        let body = null;
        for (let i = 0; i < parts.Num(); i++) {
            const part = parts.Get(i);
            names.push(`${UE.KismetSystemLibrary.GetObjectName(part)} (${UE.KismetSystemLibrary.GetObjectName(part.GetClass())}${part.IsVisible() ? "" : ", hidden"})`);
            if (part.IsVisible()) {
                hidden.push(part);
                body = body || part;
            }
        }
        if (!body)
            return log(`hammer: the weapon has no visible mesh (${names.join(", ") || "no meshes"})`), null;
        const origin = puerts.$ref(new UE.Vector(0, 0, 0)), extent = puerts.$ref(new UE.Vector(0, 0, 0)), radius = puerts.$ref(0);
        UE.KismetSystemLibrary.GetComponentBounds(body, origin, extent, radius);
        const centre = UE.KismetMathLibrary.InverseTransformLocation(weapon.GetTransform(), puerts.$unref(origin));
        const reach = Math.hypot(centre.X, centre.Y, centre.Z), half = puerts.$unref(extent);
        const along = reach > 5 ? new UE.Vector(centre.X / reach, centre.Y / reach, centre.Z / reach) : new UE.Vector(1, 0, 0);
        log(`hammer: weapon parts ${names.join(", ")}; its body lies ${Math.round(reach)} cm from the hand toward ${along.X.toFixed(2)} ${along.Y.toFixed(2)} ${along.Z.toFixed(2)}, `
            + `box ${Math.round(2 * half.X)} x ${Math.round(2 * half.Y)} x ${Math.round(2 * half.Z)} cm`);

        const points = UE.NewArray(UE.Vector), normals = UE.NewArray(UE.Vector), coordinates = UE.NewArray(UE.Vector2D);
        const triangles = UE.NewArray(UE.BuiltinInt), colors = UE.NewArray(UE.Color), tangents = UE.NewArray(UE.ProcMeshTangent);
        const count = data.points.length / 3, white = new UE.Color(255, 255, 255, 255);
        for (let i = 0; i < count; i++) {
            points.Add(new UE.Vector(data.points[3 * i] - MODEL.SLIDE, data.points[3 * i + 1], data.points[3 * i + 2]));
            normals.Add(new UE.Vector(data.normals[3 * i], data.normals[3 * i + 1], data.normals[3 * i + 2]));
            coordinates.Add(new UE.Vector2D(data.coordinates[2 * i], data.coordinates[2 * i + 1]));
            const tangent = new UE.ProcMeshTangent();
            tangent.TangentX = new UE.Vector(data.tangents[3 * i], data.tangents[3 * i + 1], data.tangents[3 * i + 2]);
            tangent.bFlipTangentY = data.flips[i] == 1;
            tangents.Add(tangent);
            colors.Add(white);  // a material may fade a mesh by its points' colours: fully there
        }
        // Each triangle both ways round. The game draws only the side of a triangle that faces the eye; with the
        // triangles the wrong way round one looks through the near wall onto the inside of the far one (game
        // test: the hammer looked see-through). Both ways, the outside is drawn whichever way the game counts.
        for (let i = 0; i < data.triangles.length; i += 3) {
            const [a, b, c] = [data.triangles[i], data.triangles[i + 1], data.triangles[i + 2]];
            triangles.Add(a);
            triangles.Add(b);
            triangles.Add(c);
            triangles.Add(a);
            triangles.Add(c);
            triangles.Add(b);
        }
        const size = MODEL.SCALE;   // the hammer is made in its final size (model/export_for_mod.py)
        const turn = UE.KismetMathLibrary.ComposeRotators(new UE.Rotator(0, 0, MODEL.ROLL), UE.KismetMathLibrary.MakeRotFromX(along));
        const mesh = weapon.AddComponentByClass(UE.ProceduralMeshComponent.StaticClass(), false,
            UE.KismetMathLibrary.MakeTransform(new UE.Vector(0, 0, 0), turn, new UE.Vector(size, size, size)), false);
        mesh.CreateMeshSection(0, points, triangles, normals, coordinates, colors, tangents, false);
        mesh.SetCollisionEnabled(UE.ECollisionEnabled.NoCollision);
        // The numbers the game gives the weapon's own mesh for its material (how far it is dissolved, for one):
        // the hammer gets the same, or the material takes it for a weapon that is fading away (game test: see-through).
        attempt("custom data", () => {
            const numbers = body.CustomPrimitiveData.Data, list = [];
            for (let i = 0; i < numbers.Num(); i++) {
                mesh.SetCustomPrimitiveDataFloat(i, numbers.Get(i));
                list.push(Number(numbers.Get(i)).toFixed(2));
            }
            log(`hammer: the weapon mesh's custom numbers [${list.join(", ")}]; its material's blend mode `
                + `${attempt("blend mode", () => body.GetMaterial(0).GetBlendMode())}, materials ${body.GetNumMaterials()}`);
        });

        // The hammer wears the weapon's own material, with the hammer's pictures in its texture inputs.
        // The material the hammer wears. The Armeebrecher's own is an elite enemy's, drawn "masked": it leaves
        // out parts of a surface by rules of its own, and with the hammer's pictures in it the hammer was blotched
        // or gone (game test, several times). So the hammer takes the material of another weapon the player
        // carries, one that is drawn solid, when there is one; else the Armeebrecher's.
        let parent = body.GetMaterial(0);
        attempt("material donor", () => {
            const found = puerts.$ref(UE.NewArray(UE.Actor)), seen = [];
            player().GetAttachedActors(found, true, true);
            const carried = puerts.$unref(found);
            let donor = null;
            const colourOf = (material) => textureInputs(material).find((input) => /albedo|base|colou?r|diffuse/i.test(input.name));
            const own = colourOf(parent);
            seen.push(`the weapon itself: ${UE.KismetSystemLibrary.GetObjectName(parent)} (colour picture ${own ? own.texture + (own.virtual ? ", virtual" : ", ordinary") : "none"})`);
            for (let i = 0; i < carried.Num(); i++) {
                const other = carried.Get(i);
                if (other === weapon || !/weapon/i.test(String(UE.KismetSystemLibrary.GetObjectName(other.GetClass()))))
                    continue;
                const meshes = other.K2_GetComponentsByClass(UE.MeshComponent.StaticClass());
                for (let m = 0; m < meshes.Num(); m++) {
                    const material = meshes.Get(m).GetMaterial(0);
                    if (!material)
                        continue;
                    const colour = colourOf(material);
                    seen.push(`${UE.KismetSystemLibrary.GetObjectName(other.GetClass())}: ${UE.KismetSystemLibrary.GetObjectName(material)} `
                        + `(blend mode ${material.GetBlendMode()}, colour picture ${colour ? colour.texture + (colour.virtual ? ", virtual" : ", ordinary") : "none"})`);
                    if (!donor && colour && !colour.virtual)
                        donor = material;
                }
            }
            log(`hammer: materials carried: ${seen.join("; ")}`);
            if (VARIANTS[variant].donor && donor) {
                parent = donor;
                log(`hammer: wears the material ${UE.KismetSystemLibrary.GetObjectName(donor)}`);
            }
            else if (VARIANTS[variant].donor)
                log("hammer: no carried weapon has an ordinary colour picture, the weapon's own material stays");
        });
        if (VARIANTS[variant].flat) attempt("flat material", () => {
            const flat = FLAT_MATERIALS.map((path) => UE.Object.Load(path)).find((material) => material);
            if (!flat)
                return log("hammer: the engine's widget materials are not in the game");
            parent = flat;
            log(`hammer: the engine's unlit material ${UE.KismetSystemLibrary.GetObjectName(flat)}`);
        });
        if (VARIANTS[variant].engine) {
            parent = UE.Object.Load(ENGINE_MATERIAL) || parent;
            log(`hammer: the engine's material ${UE.KismetSystemLibrary.GetObjectName(parent)}`);
        }
        log(`hammer: variant ${VARIANTS[variant].name}`);
        const inputs = textureInputs(parent), set = [];
        log(`hammer: the weapon's material ${parent ? UE.KismetSystemLibrary.GetObjectName(parent) : "none"} has the texture inputs `
            + (inputs.map((input) => `${input.name} (${input.texture})`).join(", ") || "none"));
        attempt("material settings", () => {
            // The numbers and colours the weapon's material is set to: a tint among them would colour the hammer too.
            const settings = [];
            for (let material = parent, depth = 0; material && depth < 5; material = material.Parent, depth++) {
                const numbers = material.ScalarParameterValues, colours = material.VectorParameterValues;
                for (let i = 0; numbers && i < numbers.Num(); i++)
                    settings.push(`${numbers.Get(i).ParameterInfo.Name} ${Number(numbers.Get(i).ParameterValue).toFixed(2)}`);
                for (let i = 0; colours && i < colours.Num(); i++) {
                    const c = colours.Get(i).ParameterValue;
                    settings.push(`${colours.Get(i).ParameterInfo.Name} (${c.R.toFixed(2)} ${c.G.toFixed(2)} ${c.B.toFixed(2)} ${c.A.toFixed(2)})`);
                }
            }
            log(`hammer: the material's settings: ${settings.join(", ") || "none"}`);
        });
        if (parent) {
            const material = mesh.CreateDynamicMaterialInstance(0, parent, "None");
            for (const input of inputs) {
                // The names the game's weapon materials use (game test: Albedo, Normal, Mix, and MaskTex for an effect).
                const kind = /mask|fx/i.test(input.name) ? null
                    : /normal/i.test(input.name) ? "normal"
                    : /^mix$|orm|arm/i.test(input.name) ? "rm"
                    : /albedo|base|colou?r|diffuse/i.test(input.name) ? "basecolor" : null;
                if (kind && VARIANTS[variant].textures.includes(kind) && hammerTextures[kind]) {
                    // By the input's full address: this material is built in layers, and an input of a layer is not
                    // reached by its name alone (game test: the hammer kept the weapon's own pictures).
                    material.SetTextureParameterValueByInfo(input.info, hammerTextures[kind]);
                    const now = material.K2_GetTextureParameterValueByInfo(input.info);
                    set.push(`${input.name} [${input.layer}] = ${kind} (reads back ${now ? UE.KismetSystemLibrary.GetObjectName(now) : "none"})`);
                }
            }
        }
        // Dry: the weapon's material is set fully wet, which makes every surface a dark gloss; the Masskrug is painted stone.
        if (VARIANTS[variant].flat) attempt("flat picture", () => {
            const material = mesh.GetMaterial(0);
            material.SetTextureParameterValue("SlateUI", hammerTextures.basecolor);
            material.SetVectorParameterValue("TintColorAndOpacity", new UE.LinearColor(FLAT_LEVEL, FLAT_LEVEL, FLAT_LEVEL, 1));
            material.SetScalarParameterValue("OpacityFromTexture", 0);
            const now = material.K2_GetTextureParameterValue("SlateUI");
            log(`hammer: unlit, its picture reads back ${now ? UE.KismetSystemLibrary.GetObjectName(now) : "none"}`);
        });
        if (VARIANTS[variant].dry) attempt("dry material", () => {
            const material = mesh.GetMaterial(0);
            // Every layer's wetness, each by its full address.
            for (let from = material.Parent, depth = 0; from && depth < 5; from = from.Parent, depth++) {
                const numbers = from.ScalarParameterValues;
                for (let i = 0; numbers && i < numbers.Num(); i++)
                    if (/^Wetness (Max|Min)$/.test(String(numbers.Get(i).ParameterInfo.Name)))
                        material.SetScalarParameterValueByInfo(numbers.Get(i).ParameterInfo, 0);
            }
        });
        log(`hammer: shown ${size.toFixed(2)} times its size; texture inputs set: ${set.join(", ") || "none"}`);
        for (const part of hidden)
            part.SetVisibility(false, false);
        // Whether the hammer still wears its own material a moment later, or the game gave it another.
        setTimeout(() => attempt("material check", () => {
            if (!valid(mesh))
                return;
            const worn = mesh.GetMaterial(0), first = inputs.find((input) => /albedo|base|colou?r/i.test(input.name));
            const picture = worn && first && worn.K2_GetTextureParameterValueByInfo ? worn.K2_GetTextureParameterValueByInfo(first.info) : null;
            log(`hammer after 3 s: material ${worn ? UE.KismetSystemLibrary.GetObjectName(worn) : "none"}, its ${first ? first.name : "colour input"} is `
                + `${picture ? UE.KismetSystemLibrary.GetObjectName(picture) : "not readable"}`);
            // Whether the game shows it: the flags that hide a mesh, and where it is.
            const at = mesh.K2_GetComponentLocation(), me = player().K2_GetActorLocation();
            log(`hammer after 3 s: visible ${mesh.IsVisible()}, hidden in game ${mesh.bHiddenInGame}, weapon actor hidden ${weapon.bHidden}, `
                + `${Math.round(Math.hypot(at.X - me.X, at.Y - me.Y, at.Z - me.Z))} cm from the player, the weapon's own parts visible: `
                + hidden.map((part) => part.IsVisible()).join(", "));
        }), 3000);
        return { weapon, mesh, hidden };
    }) || null;
}

function hideModel(old) {
    attempt("hammer removal", () => {
        if (valid(old.mesh))
            old.mesh.K2_DestroyComponent(old.mesh);
        for (const part of old.hidden)
            if (valid(part))
                part.SetVisibility(true, false);
    });
}

function hideModels() {
    const old = models;
    models = [];
    old.forEach(hideModel);
}

// Once a second: every Armeebrecher in the world wears the hammer. That is the one in the player's hand, and any
// other the game makes of the same kind, such as one it shows in a menu.
function modelTick(pc, character) {
    if (Date.now() - modelChecked < 1000)
        return;
    modelChecked = Date.now();
    attempt("hammer check", () => {
        const weapons = [];
        if (on) {
            if (!weaponClass) {
                // The class is learned from the Armeebrecher the player carries.
                const found = puerts.$ref(UE.NewArray(UE.Actor));
                character.GetAttachedActors(found, true, true);
                const attached = puerts.$unref(found);
                for (let i = 0; i < attached.Num() && !weaponClass; i++)
                    if (/Weapon_Hun_PoJun/i.test(String(UE.KismetSystemLibrary.GetObjectName(attached.Get(i).GetClass()))))
                        weaponClass = attached.Get(i).GetClass();
            }
            if (weaponClass) {
                const found = puerts.$ref(UE.NewArray(UE.Actor));
                UE.GameplayStatics.GetAllActorsOfClass(character, weaponClass, found);
                const all = puerts.$unref(found);
                for (let i = 0; i < all.Num(); i++)
                    weapons.push(all.Get(i));
            }
        }
        // Hammers whose weapon is gone, or whose mesh the game took away, go; weapons without a hammer get one.
        const kept = [];
        for (const model of models) {
            if (valid(model.weapon) && valid(model.mesh) && weapons.includes(model.weapon))
                kept.push(model);
            else
                hideModel(model);
        }
        models = kept;
        for (const weapon of weapons) {
            if (models.some((model) => model.weapon === weapon))
                continue;
            const model = showModel(pc, weapon);
            if (model)
                models.push(model);
        }
    });
}

// ---------------------------------------------------------------------------------------------------------------
// The hammer's pictures on the screen
// ---------------------------------------------------------------------------------------------------------------

// The game shows a weapon's picture by putting its texture into an image widget (game test: the HUD's weapon
// slot, W_WeaponUI, holds Icon_Hud_Weapon_PoJun). Ten times a second the mod looks through the widgets that have to
// do with weapons and puts the hammer's picture wherever one of the Armeebrecher's is shown. The game sets its
// own picture again whenever it redraws a slot, hence the repeating.
// The character menu (game test, menu_dump_4.txt): the weapon tiles (W_ButtonBase_Weapon) draw T_Icon_Weapon_PoJun
// through a material, as its texture "IconTexture"; the big picture is T_Weapon_PoJun in WB_Character_V4's
// RenderIcon. It is a picture, not a model: the menu shows no 3D weapon.
// Each hammer picture is laid out as the game's own is (game test: the game's three pictures were saved and
// measured): the HUD's lies level and the HUD turns it into its slot; the menu's is small, right of the middle.
const PICTURES = { Icon_Hud_Weapon_PoJun: "hammer_hud.png", T_Icon_Weapon_PoJun: "hammer_icon.png", T_Weapon_PoJun: "hammer_render.png" };  // the game's texture -> the file in data/
const PICTURE_OWNERS =/weapon|WB_Character/i;     // the classes of the widgets looked through
const pictureTextures = {};
let picturesChecked = 0;
const picturesSaid = {};

function pictureTick(pc) {
    if (!on || Date.now() - picturesChecked < 100)
        return;
    picturesChecked = Date.now();
    attempt("pictures", () => {
        const found = puerts.$ref(UE.NewArray(UE.UserWidget));
        UE.WidgetBlueprintLibrary.GetAllWidgetsOfClass(pc, found, UE.UserWidget.StaticClass(), false);
        const widgets = puerts.$unref(found);
        const swap = (widget, depth, owner) => {
            if (!widget || depth > 30)
                return;
            const resource = widget.Brush ? widget.Brush.ResourceObject : null;
            let file = resource ? PICTURES[String(UE.KismetSystemLibrary.GetObjectName(resource))] : null;
            // A picture drawn through a material: the material's texture that is one of the Armeebrecher's.
            let parameter = null;
            const given = resource && !file ? resource.TextureParameterValues : null;
            for (let i = 0; given && i < given.Num() && !file; i++) {
                const value = given.Get(i).ParameterValue;
                file = value ? PICTURES[String(UE.KismetSystemLibrary.GetObjectName(value))] : null;
                if (file)
                    parameter = String(given.Get(i).ParameterInfo.Name);
            }
            let about = "";
            // Not listed, but still the material's icon (game test: under the hammer in a chosen tile lay a
            // shadow of the Armeebrecher's shape): the material is asked for it by name.
            if (resource && !file && typeof resource.K2_GetTextureParameterValue == "function") {
                const value = resource.K2_GetTextureParameterValue("IconTexture");
                file = value ? PICTURES[String(UE.KismetSystemLibrary.GetObjectName(value))] : null;
                if (file)
                    parameter = "IconTexture";
            }
            if (file) {
                if (pictureTextures[file] === undefined)
                    pictureTextures[file] = UE.KismetRenderingLibrary.ImportFileAsTexture2D(pc, dataFile(file)) || null;
                if (pictureTextures[file]) {
                    if (parameter)
                        resource.SetTextureParameterValue(parameter, pictureTextures[file]);
                    else
                        widget.SetBrushResourceObject(pictureTextures[file]);   // the slot keeps its size and tint
                    if (!picturesSaid[owner + file]) {
                        picturesSaid[owner + file] = true;
                        log(`picture: ${file} put into ${owner} > ${UE.KismetSystemLibrary.GetObjectName(widget)}${about}`);
                    }
                }
            }
            let count = 0;
            try { count = widget.GetChildrenCount(); } catch (e) { }    // not every widget holds others
            for (let i = 0; i < count; i++)
                swap(widget.GetChildAt(i), depth + 1, owner);
        };
        for (let i = 0; i < widgets.Num(); i++) {
            const widget = widgets.Get(i), kind = String(UE.KismetSystemLibrary.GetObjectName(widget.GetClass()));
            if (PICTURE_OWNERS.test(kind) && widget.WidgetTree && widget.WidgetTree.RootWidget)
                swap(widget.WidgetTree.RootWidget, 0, kind);
        }
    });
}

// ---------------------------------------------------------------------------------------------------------------
// Where the game shows the Armeebrecher in its menus
// ---------------------------------------------------------------------------------------------------------------

// Key M writes menu_dump.txt beside this file: every picture on the screen whose image has the Armeebrecher in its
// name (its icon in the weapon list and on the HUD), with the widgets it sits in, and every model in the world
// that is the Armeebrecher's (the one in the hand, and the one the weapon menu shows). Press it with the weapon
// menu open on the Armeebrecher. Nothing is changed: it is the groundwork for putting the hammer there too.
const dumpKey = key("M");
let dumpWasDown = true;
let screenChecked = 0, screenNow = null, dumpAt = 0, dumps = 0;
const nameOf = (object) => object ? String(UE.KismetSystemLibrary.GetObjectName(object)) : "none";
const IS_IT = /PoJun/i;

function dumpMenu(pc, character) {
    const lines = [], visited = new Set();
    // A widget and the widgets inside it; path: the names from the outermost widget down.
    const walk = (widget, trail) => {
        if (!widget || trail.length > 40)
            return;
        const here = trail.concat([`${nameOf(widget)}<${nameOf(widget.GetClass())}>`]);
        attempt("picture", () => {
            const resource = widget.Brush && widget.Brush.ResourceObject;
            if (!resource)
                return;
            let shown = nameOf(resource), kind = nameOf(resource.GetClass());
            // A picture drawn through a material: the textures the material is given.
            const given = resource.TextureParameterValues;
            for (let i = 0; given && i < given.Num(); i++)
                shown += ` | ${given.Get(i).ParameterInfo.Name}=${nameOf(given.Get(i).ParameterValue)}`;
            if (resource.Parent)
                shown += ` | parent ${nameOf(resource.Parent)}`;
            if (IS_IT.test(shown))
                lines.push(`picture: ${shown} (${kind})`, `    in ${here.join(" > ")}`);
        });
        // Each user widget is walked by itself (the list holds them all), so a widget inside another is not entered here.
        if (trail.length == 0) attempt("inner tree", () => {
            if (widget.WidgetTree && widget.WidgetTree.RootWidget)
                walk(widget.WidgetTree.RootWidget, here);
        });
        let count = 0;
        try { count = widget.GetChildrenCount(); } catch (e) { }
        for (let i = 0; i < count; i++)
            walk(widget.GetChildAt(i), here);
    };
    attempt("widget dump", () => {
        const found = puerts.$ref(UE.NewArray(UE.UserWidget));
        UE.WidgetBlueprintLibrary.GetAllWidgetsOfClass(pc, found, UE.UserWidget.StaticClass(), false);
        const tops = puerts.$unref(found), kinds = {};
        for (let i = 0; i < tops.Num(); i++)
            kinds[nameOf(tops.Get(i).GetClass())] = (kinds[nameOf(tops.Get(i).GetClass())] || 0) + 1;
        lines.push(`user widgets: ${tops.Num()}`, Object.keys(kinds).sort().map((kind) => `${kind} x${kinds[kind]}`).join(", "), "");
        for (let i = 0; i < tops.Num(); i++) {
            const key = String(UE.KismetSystemLibrary.GetPathName(tops.Get(i)));
            if (visited.has(key))
                continue;
            visited.add(key);
            walk(tops.Get(i), []);
        }
    });
    attempt("model dump", () => {
        const found = puerts.$ref(UE.NewArray(UE.Actor));
        UE.GameplayStatics.GetAllActorsOfClass(character, UE.Actor.StaticClass(), found);
        const actors = puerts.$unref(found), me = character.K2_GetActorLocation();
        lines.push("", `actors in the world: ${actors.Num()}`);
        for (let i = 0; i < actors.Num(); i++) {
            const actor = actors.Get(i), actorClass = nameOf(actor.GetClass());
            const meshes = actor.K2_GetComponentsByClass(UE.SkinnedMeshComponent.StaticClass());
            for (let m = 0; m < meshes.Num(); m++) {
                const part = meshes.Get(m), asset = attempt("asset", () => part.GetSkinnedAsset());
                if (!IS_IT.test(nameOf(asset)) && !IS_IT.test(actorClass))
                    continue;
                const at = part.K2_GetComponentLocation(), parent = actor.GetAttachParentActor();
                lines.push(`model: ${nameOf(asset)} on ${nameOf(part)}<${nameOf(part.GetClass())}> of ${nameOf(actor)}<${actorClass}>`,
                    `    visible ${part.IsVisible()}, actor hidden ${actor.bHidden}, ${Math.round(Math.hypot(at.X - me.X, at.Y - me.Y, at.Z - me.Z))} cm from the player, `
                    + `attached to ${parent ? nameOf(parent) + "<" + nameOf(parent.GetClass()) + ">" : "nothing"}, owner ${nameOf(actor.GetOwner())}`);
            }
            if (/preview|display|showcase|scenecapture|studio|exhibit/i.test(actorClass))
                lines.push(`maybe a show actor: ${nameOf(actor)}<${actorClass}>, hidden ${actor.bHidden}`);
        }
    });
    dumps++;
    const file = UE.KismetSystemLibrary.ConvertToAbsolutePath(String(__dirname).replace(/[\\/]+$/, "") + `/menu_dump_${dumps}.txt`);
    UE.EasyCsv.SaveStringToFileWithFullPath(lines.join(String.fromCharCode(10)), file);
    log(`menu dump: ${lines.length} lines written to ${file}`);
}

function tick() {
    const pc = UE.GameplayStatics.GetPlayerController(gameInstance, 0);
    const character = pc ? player() : null;
    // The row is put into the table as early as possible: a save game that holds the weapon asks for it when it loads.
    if (valid(pc)) {
        ensureRow();
        if (rowState == "added" && Date.now() - rowChecked > 5000) attempt("weapon row check", () => {
            rowChecked = Date.now();
            if (!UE.DataTableFunctionLibrary.DoesDataTableRowExist(UE.DataTable.Load(WEAPON_TABLE), NEW_ID)) {
                log("weapon row: gone from the table (the game loaded the table anew), adding it again");
                rowState = "";
            }
        });
    }
    if (!valid(character)) {
        if (state)
            log("no player: weapon laid down");
        state = null;   // the player object is gone, with the light and the listener on it
        hideHud();
        return;
    }
    const down = pc.IsInputKeyDown(toggleKey), gameplay = inGameplay(pc);
    if (down && !wasDown && gameplay) {
        on = !on;
        log(on ? "on" : "off");
        if (!on && state)
            state.commits = 0;
    }
    wasDown = down;
    if (gameplay)
        weaponKey(pc, character);
    pictureTick(pc);
    const dumpDown = pc.IsInputKeyDown(dumpKey);
    if (dumpDown && !dumpWasDown)
        attempt("menu dump", () => dumpMenu(pc, character));
    dumpWasDown = dumpDown;
    // In the game's menus the keys do not reach the mod (game test). So the dump also runs by itself: whenever
    // the set of widgets on the screen changes (a menu opens, a page turns), three seconds later.
    if (Date.now() - screenChecked > 1500) attempt("screen check", () => {
        screenChecked = Date.now();
        const found = puerts.$ref(UE.NewArray(UE.UserWidget));
        UE.WidgetBlueprintLibrary.GetAllWidgetsOfClass(pc, found, UE.UserWidget.StaticClass(), false);
        const screen = puerts.$unref(found).Num();     // the game's menus live inside one top widget: their widgets are counted
        if (screen != screenNow) {
            if (screenNow !== null && dumps < 12 && Math.abs(screen - screenNow) >= 5) {
                dumpAt = Date.now() + 3000;
                log(`screen changed: ${screen} user widgets (were ${screenNow})`);
            }
            screenNow = screen;
        }
    });
    if (dumpAt && Date.now() >= dumpAt) {
        dumpAt = 0;
        attempt("menu dump", () => dumpMenu(pc, character));
    }
    const variantDown = pc.IsInputKeyDown(variantKey);
    if (variantDown && !variantWasDown && gameplay) {
        variant = (variant + 1) % VARIANTS.length;
        hideModels();       // built anew with the next check, within a second
        modelChecked = 0;
        SAYS.variant = [VARIANTS[variant].name];
        say("variant", true);
    }
    variantWasDown = variantDown;
    modelTick(pc, character);
    if (state && state.who != UE.KismetSystemLibrary.GetPathName(character)) {
        state = null;   // a new player object (travel, load): bind anew
        hideHud();
    }
    if (!state)
        bind(character);
    if (state.releasing && Date.now() >= state.releaseUntil) {
        state.releasing = false;
        state.commits = 0;
    }
    applyAttack(character);
    // The weapon in hand changes, and at a load it is not attached yet: the light follows it, looked at every 2 seconds.
    if (SETTINGS.LIGHT && Date.now() - (state.lightChecked || 0) > 2000) {
        state.lightChecked = Date.now();
        state.light = addLight(character) || state.light;
    }
    drawLight();
    if (on)
        showHud();
    else
        hideHud();
    // Not over the game's menus (game test: the jump key stays bound there): they pause the game or show the cursor.
    drawHud(gameplay && !UE.GameplayStatics.IsGamePaused(character) && !pc.bShowMouseCursor);
}

const timer = setInterval(() => {
    try {
        tick();
        errorSaid = false;
    }
    catch (e) {
        if (!errorSaid)
            log("tick failed: " + e);
        errorSaid = true;
    }
}, TICK_MS);

log(`started: ${NAME}; press ${SETTINGS.KEY} to switch it off and on`);

exports.stop = function () {
    clearInterval(timer);
    unbind();
    hideModels();
    attempt("screen removal", hideHud);
    if (tip && valid(tip.widget))
        tip.widget.RemoveFromParent();
    log("stopped");
};
