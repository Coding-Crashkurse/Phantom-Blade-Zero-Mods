// Gauntlet for Phantom Blade Zero: a PBZModLoader mod.
//
// A run of boss fights, built after the Gauntlets of Strength of Sekiro. You fight one opponent; when it has
// fallen you are free, as at the idol in Sekiro: at a bell (its menu's entry now reads "Gauntlet: nächster
// Gegner") or with the key the board opens again: the fallen opponent is struck through, the next one is
// revealed, and you call it when you are ready (or rest first, or give up). The opponents after the next one stay unknown and
// cannot be chosen, in every run anew. When your health runs out the run is over (you do not really die: no death is
// counted and nothing is lost), and the next run starts at the first opponent with nothing struck.
//
// At a bell, the bell's menu has a new entry "Gauntlets" at its end; it opens the gauntlet menu. Anywhere
// else, press G (gamepad: hold L3 and press D-pad up) while you play: the gauntlet screen opens.
//
// The screen is a board in ink. Left, the gauntlet's ladder: each opponent's picture in a brush frame and its
// name on a brush stroke. Right, the chosen opponent's codex picture, where you fight, your best run.
//   left / right               another gauntlet
//   Tab / R / Y (Triangle)     another arena: one whose bell you have rung in this playthrough, or where you stand
//   Enter / Space / A (Cross)  start          Backspace / G / B (Circle)  close
// Between two fights the same board shows the run so far:
//   Enter / Space / A          the next opponent arrives
//   Tab / R / Y                rest: your health is filled (once per stop; the result counts your rests)
//   Backspace / G / B          close the board for now; the run waits
//   Delete / X (Square), twice give up
// When the run is over the board shows how: a win stamps your rank and lists the best runs, a loss shows the
// opponent you fell to. When an opponent arrives, a card names it.
// The last gauntlet holds every opponent and stays sealed until the three longer trials are won.
// An arena is loaded with the game's own travel, and the same travel brings you back when the run is over. The
// place "Each opponent's own arena" takes you to each opponent's own arena, where the mod knows it.
// During a fight the key asks whether to give up.
//
// How:
// - Each boss is the game's own boss actor, spawned in front of you with the engine's deferred spawn. Before it
//   starts, the mod takes its loot component, keeps it out of the codex and out of the game's boss records.
// - A boss with several phases is several actors: when one has fallen the next takes its place.
// - While a run lasts, your lowest possible health is 1 (the game's own Health_Min attribute). At that floor the
//   run counts as lost, your health is refilled and the floor put back.
// - Text on screen is the game's own tip strip, the defeat banner the game's own, the pause after a kill the
//   engine's time dilation.
//
// The run counts your perfect deflects, your normal deflects and the hits you take, and gives a rank for a win:
// S without a hit, A up to 3, B up to 8, C beyond. The ten fastest wins of each gauntlet are kept in a list
// (gauntlet_records.json next to this main.js).
// - Deflects are the game's own events on the boss whose attack you deflected, the ones its health bar listens to;
//   hits are the drops of your health, a drop that runs on over several moments counted once (the game's hit event also fires for a hit you deflect: game test).
//
// - A spawned boss has level 0 and bare base values. The mod multiplies its health, attack and Sha-Chi by the
//   game's own monster level curves: value = base x (1 + curve(level)).
// - The screen is built from the engine's own widgets (canvas, image, text) inside one of the game's user widgets;
//   the opponents' pictures and names in the game's language come from the game's codex table, the brush strokes
//   from art/*.png next to this file (drawn by make_art.py, read with the engine's ImportFileAsTexture2D).
//   Should the screen fail to build, the menu falls back to lines of the game's tip strip.
// - While the menu is open the player's and the controller's input are disabled; the mod reads the keys itself.
// - The bell menu's entry is one more of the menu's own buttons (W_DialogueButton), put at the end of its list
//   and into its button group, so look, sound and gamepad navigation are the game's. No function of the
//   menu is replaced: the mod looks for an open bell menu four times a second and adds the entry when it is missing.
// - Travel is the game's own TeleportTo (it saves and loads). The bell it is given becomes your bell, so an arena
//   is offered only while its bell is rung, and the way back uses the bell you had before.
//
// Boss classes, the three safeguards above and the arenas' standing spots follow the public notes of the Boss Rush
// mod by continuationcs.

const SETTINGS = {
    SOUNDS: false,          // the mod's own sounds (brush strokes, stamp, drum). Off: the engine's media player refuses to play them in this game (game test)
    FOG_DOORS: true,        // shut the arena's fog doors while its boss is fought, as the game does
    FOG_DOOR_REACH: 8000,   // cm round the opponent: the doors this near are the arena's
    INTO_ARENA: false,      // false: a fight in a boss's arena starts at the bell beside it. true: on the boss's own spot inside (untested)
    KEY: "G",
    PAD_HOLD: "Gamepad_LeftThumbstick", PAD_PRESS: "Gamepad_DPad_Up",
    SPAWN_DISTANCE: 900,    // cm in front of you
    REVEAL_PAUSE_MS: 3500,  // between a boss's fall and the board that offers the next one
    SLOW_MOTION: 0.2,       // game speed right after a kill
    SLOW_MOTION_MS: 1400,   // for this long (real time)
    // The ladder: the list of the run's opponents at the left of the screen. Offsets in screen units from where
    // the game puts its tip strip (top centre); STEP is the distance between two lines.
    LADDER: { X: -560, Y: 140, STEP: 62, SCALE: 0.8, SECONDS: 4 },
    // The menu: two columns of lines, offsets as for the ladder. Left the gauntlets, right the chosen one's ladder
    // and its details.
    MENU: { LEFT_X: -520, RIGHT_X: 300, Y: 110, STEP: 58, SCALE: 0.8 },
    // How strong the bosses are: the level of the game's own monster curves, 1 (the first valley) to 25 (the last
    // area). Each playthrough after the first adds 25, as in the game.
    BOSS_LEVEL: 20,
};

const UE = require("ue");
const puerts = require("puerts");

// The opponents: the game's boss classes. phases: the actors that follow when this one has fallen.
// Where the game itself has the boss, as far as known:
// arena: the id of a hand-written arena (see ARENAS), a spot on the boss's own ground;
// bell: the bell that boss guides name beside the fight (phantomblade.guide/bosses, kungfupunk.com/bosses).
//   Zhu Yuan: the furnace of Pangzhen's Sha-Chi Tower; Wu Lengshuang: The Confinement, in the Mandate
//   Encampment; Lei Dang: Perfect Vessel Pond, in the Mirage Estate (allthings.how's boss guides).
// ownBanner: the boss's AI shows the defeat banner itself.
const MOBS = "/PBZCombatAsset/ActorData/Mobs/", NORMAL = "/Game/RenewalContent/Actors/Mobs/Normal/";
const cls = (folder, name) => `${folder}${name}.${name}_C`;
const BOSSES = {
    // In no gauntlet: the game has no arena for him (he roams a riverbed far from any bell).
    jaggedSteel: { name: "Jagged Steel, the Raging Brute", cls: cls(NORMAL, "BP_Monster_MobMan_Elite_Sword") },
    pengMeng: { name: "Peng Meng, the Axemaster", cls: cls(MOBS + "044_PengMeng/", "BP_Monster_PengMeng_Axe"), ownBanner: true, arena: "xigu_axe" },
    hua: { name: "Hua, the Deadly Bride", cls: cls(MOBS + "042_AHua/", "BP_Monster_AHua_GuiTouDao"), ownBanner: true, bell: "Bell_NLES_017" },
    jingYe: { name: "Jing Ye, the Outlaw", cls: cls(MOBS + "045_JingYe/", "BP_Monster_JingYe"), ownBanner: true, bell: "Bell_LZSJ_004" },
    theHunt: { bell: "Bell_NLES_007", name: "The Hunt", cls: cls(MOBS + "048_HookMan/", "BP_Monster_HookMan"),
        phases: [{ name: "The Hunt, Sixfold Scythe", cls: cls(MOBS + "051_HookMan_P2/", "BP_Monster_HookMan_P2") }] },
    huaQianxiao: { name: "Hua Qianxiao, the Sword Fool", cls: cls(MOBS + "HuaQianXiao/", "BP_Monster_HuaQianXIao"), ownBanner: true, bell: "Bell_LZSJ_003" },
    zhuYuan: { name: "Zhu Yuan, the Searing Blade", cls: cls(MOBS + "008_GreatBladeMan/", "BP_Monster_HuoDaoDuiZhang"), ownBanner: true, bell: "Bell_SZ_030" },
    biFeng: { name: "Bi Feng, Commander of the Great Saber", cls: cls(MOBS + "008_GreatBladeMan/", "BP_Monster_GreatBladeMan"), ownBanner: true, arena: "ddsd_blade" },
    snowstorm: { name: "The Blizzard Blademaster", cls: cls(MOBS + "FengXueDaoKe/", "BP_Monster_FengXueDaoKe"), arena: "lyz_white" },
    wuLengshuang: { name: "Wu Lengshuang, the Soft Sword", cls: cls(MOBS + "074_WuLengShuang/", "BP_Monster_WuLengShuang"), bell: "Bell_YXZR_010" },
    wuXuan: { name: "Wu Xuan, the Fallen General", cls: cls(NORMAL, "BP_Monster_WuXuan"), ownBanner: true, bell: "Bell_SZ_005" },
    ironMask: { name: "Iron Mask", cls: cls(NORMAL, "BP_Monster_IronMaskMan"), bell: "Bell_DDSD_007" },
    goldMask: { name: "Gold Mask", cls: cls(NORMAL, "BP_Monster_GoldMaskMan"), bell: "Bell_DDSD_007" },
    jadeFace: { name: "Jade-Face", cls: cls(NORMAL, "BP_Monster_JadeMaskMan"), bell: "Bell_DDSD_007" },
    // Before the Lady's statue, in the hall behind the shrine (allthings.how); his second form has a saw for a head.
    huangxing: { arena: "ddsd_hall", bell: "Bell_DDSD_007", name: "Huangxing, the Kunlun Renegade", cls: cls(NORMAL, "BP_Monster_MBoss"),
        phases: [{ name: "Huangxing, the Whirling Executioner", cls: cls(NORMAL, "BP_Monster_MBossVariants"), arena: "ddsd_hall_below" }] },
    // The last boss of the "Final Battle" ending: reached from the bell The Fallen Dream on Mount Soulrend
    // (theouterhaven.net). The game has him three times; this is the one of the ending, with his second form.
    zuoShang: { bell: "Bell_DH_007", name: "Zuo Shang, Shadow Lord of the Order", cls: cls(MOBS + "054_ZuoShang/", "BP_Monster_ZuoShang_Ending"),
        phases: [{ name: "Zuo Shang, the True Lóng", cls: cls(MOBS + "076_ZuoShang_P2/", "BP_Monster_ZuoShang_P2") }] },
    ironFever: { name: "Stone Hand Iron Fever", cls: cls(MOBS + "Luanshi/", "BP_Monster_LuanShi"), bell: "Bell_LZSJ_007" },
    wanJun: { name: "Wan Jun, the Copper Hammer", cls: cls(MOBS + "057_WanJun/", "BP_Monster_WanJun_JinGua"), bell: "Bell_YXZR_016" },
    // group: its members are fought together; the fight is won when all of them have fallen.
    // The Gold-Masked One (Mo Tian at the Long pillars): the game has four of him, one for each of his fights.
    // In no gauntlet by himself.
    goldMasked1: { name: "The Gold-Masked One", cls: cls(MOBS + "067_MoTian/", "BP_Monster_MoTian_LongZhu_01") },
    goldMasked2: { name: "The Gold-Masked One", cls: cls(MOBS + "067_MoTian/", "BP_Monster_MoTian_LongZhu_02") },
    goldMasked3: { name: "The Gold-Masked One", cls: cls(MOBS + "067_MoTian/", "BP_Monster_MoTian_LongZhu_03") },
    maskTrio: { name: "Two Gold-Masked Ones", group: ["goldMasked1", "goldMasked2"], arena: "fuji_pillar" },
    // The bosses below are in the game's list of opponents (gauntlet_codex.txt); their bells are the ones the boss
    // lists name (keengamer.com, allthings.how, mobalytics.gg), found among the game's bells by their names.
    // Village of Lu.
    biYuan: { bell: "Bell_SXC_01_06", name: "Master Bi Yuan of the Tianxuan Sect", cls: cls(MOBS + "072_CanQu_BiYuan/", "BP_Monster_BiYuan") },
    yuzan: { bell: "Bell_SXC_02_03", name: "Yuzan, No. 3 Musician Puppet", cls: cls(MOBS + "068_Yuzan/", "BP_Monster_FemaleVessel_Yuzan") },
    // In the ravine by the bell Broken Puppet Pit Entrance (keengamer.com). Only in the Trial of Puppets.
    dusk: { bell: "Bell_SXC_01_03", name: "Dusk, the Puppeteer", cls: cls(MOBS + "DangHui/", "BP_Monster_DangHui") },
    // At the Thread-Wrapped Giant Tree in the Crimson Forest, on a return visit (keengamer.com). Two forms, then
    // a secret third in which his three faces fight by themselves (the user's account of the fight): here they
    // come one after the other. The second form's actor is BP_Monster_YuCong (game test: named in the log when
    // the user fought him); the others are in the game's list of opponents.
    yucong: { arena: "fuji_tree", name: "Yucong, No. 34 Twisted Puppet", cls: cls(MOBS + "YuCong/", "BP_Monster_YuCong_P1"),
        phases: [{ name: "Yucong, No. 34 Twisted Puppet", cls: cls(MOBS + "YuCong/", "BP_Monster_YuCong") },
            { name: "Chaos Yucong", cls: cls(MOBS + "YuCong/", "BP_Monster_YuCong_HunDun") },
            { name: "Frost Yucong", cls: cls(MOBS + "YuCong/", "BP_Monster_YuCong_Bing") },
            { name: "Steel Yucong", cls: cls(MOBS + "YuCong/", "BP_Monster_YuCong_WuLi") }] },
    // Her third form is her two guardians at once. No bell is known for her: she comes to where the run is.
    ironFiend: { name: "Iron Fiend, Guardian of the Young Mistress", cls: cls(MOBS + "Luanshi/", "BP_Monster_TieGui") },
    jadeDancer: { name: "Jade Dancer, Guardian of the Young Mistress", cls: cls(NORMAL, "BP_Monster_YuU") },
    muXiaokui: { name: "Mu Xiaokui, Young Mistress of the Order", cls: cls(MOBS + "062_MuXiaoKui/", "BP_Monster_MuXiaoKui"),
        phases: [{ name: "Mu Xiaokui, Queen of Iron and Jade", cls: cls(MOBS + "064_MuXiaoKui_P2/", "BP_Monster_MuXiaoKui_P2") },
            { name: "Iron Fiend and Jade Dancer", cls: cls(MOBS + "Luanshi/", "BP_Monster_TieGui"), group: ["ironFiend", "jadeDancer"] }] },
    // Mandate Encampment: the training yard by the bell Training Grounds Depths (allthings.how).
    yubi: { bell: "Bell_YXZR_017", name: "Yubi, No. 21 Swordfighter Puppet", cls: cls(MOBS + "Yubi/", "BP_Monster_Yubi") },
    // Pangzhen. Chang Hong rides in his second form.
    changHong: { arena: "sz_shrine", name: "Chang Hong, the Thunder Spear", cls: cls(MOBS + "049_ChangHong/", "BP_Monster_ChangHong_Spear"),
        phases: [{ name: "Chang Hong, the Thunder Lancer", cls: cls(MOBS + "053_ChangHong_P2/", "BP_Monster_ChangHong_P2") }] },
    flame: { bell: "Bell_SZ_025", name: "Flame, the Mask-Bound Lion Dance Grandmaster", cls: cls(NORMAL, "BP_Monster_LionDancer"),
        phases: [{ name: "The Lion Dance Grandmaster's Last Dance", cls: cls(NORMAL, "BP_Monster_LionDancer_P2") }] },
    // Meigu Lake.
    heartpiercer: { bell: "Bell_MGH_011", name: "Heartpiercer, Elite Shadow Warden", cls: cls(MOBS + "070_GuiChai_Cyan/", "BP_Monster_GuiChai_Cyan_ShuangYue") },
    yanQiansui: { bell: "Bell_MGH_004", name: "Yan Qiansui, the Zither Maiden", cls: cls(MOBS + "073_YanQianSui/", "BP_Monster_YanQianSui") },
    youLoong: { bell: "Bell_MGH_007", name: "You Loong, the Frenzied Blackwater Crew Leader", cls: cls(MOBS + "056_YouLong/", "BP_Monster_YouLong_Harpoon") },
    // Mountain of Imprisonment.
    kuiYanyan: { bell: "Bell_DDSD_006", name: "Kui Yanyan, the Deranged", cls: cls(MOBS + "028_YanYan/", "BP_Monster_YanYan_Club") },
    // Mirage Estate.
    yuding: { bell: "Bell_XM_012", name: "Yuding, No. 12 Crescent Blade Puppet", cls: cls(MOBS + "Yuding_00/", "BP_Monster_FemaleVessel_Yuding") },
    qiuFeng: { bell: "Bell_XM_003", name: "Qiu Feng, the Crimson Boneblade", cls: cls(MOBS + "YingMei/", "BP_Monster_YingMei_RedShadowBoneBlade") },
    moYuan: { bell: "Bell_XM_DP_005", name: "Mo Yuan, Leader of the Bastion of Mo", cls: cls(MOBS + "067_MoTian/", "BP_Monster_MoTian") },
    // Mount Soulrend.
    crusher: { bell: "Bell_DH_003", name: "The Crusher and the Saw", cls: cls(NORMAL, "BP_Monster_PowerMan"),
        phases: [{ name: "The Crusher, World-Shaking Form", cls: cls(NORMAL, "BP_Monster_PowerMan_P2") }] },
    mengHua: { bell: "Bell_DH_004", name: "Meng Hua, the Merciful Lady of the Blossom Veil", cls: cls(MOBS + "078_MengHua/", "BP_Monster_MengHua") },
    leiDang: { bell: "Bell_XM_007", name: "Lei Dang, the Tiger Cannon", cls: cls(MOBS + "047_LeiDang/", "BP_Monster_LeiDang"),
        phases: [{ name: "Lei Dang, the One-Armed Tiger", cls: cls(MOBS + "050_LeiDang_P2/", "BP_Monster_LeiDang_P2") }] },
};

const GAUNTLETS = [
    // The trials follow the game's regions, and so grow harder: three to six opponents each.
    { id: "valley", name: "Trial of the Valley", fights: ["pengMeng", "hua", "theHunt"] },
    { id: "three", name: "Trial of the Forest", fights: ["jingYe", "huaQianxiao", "ironFever"] },
    { id: "village", name: "Trial of the Village", fights: ["biYuan", "yuzan", "muXiaokui"] },
    { id: "mandate", name: "Trial of the Mandate", fights: ["wanJun", "wuLengshuang", "yubi", "zhuYuan"] },
    { id: "town", name: "Trial of the Town", fights: ["wuXuan", "changHong", "flame"] },
    { id: "lake", name: "Trial of the Lake", fights: ["heartpiercer", "yanQiansui", "youLoong", "snowstorm"] },
    { id: "masks", name: "Trial of Masks", fights: ["kuiYanyan", "biFeng", "ironMask", "goldMask", "jadeFace", "huangxing"] },
    { id: "estate", name: "Trial of the Estate", fights: ["yuding", "qiuFeng", "leiDang", "moYuan"] },
    { id: "soulrend", name: "Trial of Soulrend", fights: ["crusher", "mengHua", "zuoShang"] },
    // Apart from the ladder: a trial by theme, whose opponents also stand in the trials of their regions, and
    // the odd one, two at once. Neither is needed for the last trial.
    { id: "puppets", name: "Trial of Puppets", fights: ["yuzan", "yubi", "yuding", "dusk", "yucong"] },
    { id: "trio", name: "Twin Visage", fights: ["maskTrio"] },
    // Every opponent in one run. needs: sealed until each of these trials has been won once.
    { id: "all", name: "Trial of Mortals", needs: ["valley", "three", "village", "mandate", "town", "lake", "masks", "estate", "soulrend"],
        fights: ["pengMeng", "hua", "theHunt", "jingYe", "huaQianxiao", "ironFever", "biYuan", "yuzan", "muXiaokui", "wanJun", "wuLengshuang",
            "yubi", "zhuYuan", "wuXuan", "changHong", "flame", "heartpiercer", "yanQiansui", "youLoong", "snowstorm", "kuiYanyan", "biFeng", "ironMask",
            "goldMask", "jadeFace", "huangxing", "yuding", "qiuFeng", "leiDang", "moYuan", "crusher", "mengHua", "zuoShang"] },
];
// Vows: hardships the player takes on before a run. They are kept with the run's result.
const VOWS = [
    { id: "noRest", name: "No Rest", text: "No resting between the fights." },
    { id: "frenzy", name: "Frenzy", text: "The opponents act a third faster." },
    { id: "might", name: "Might", text: "The opponents are 20 levels stronger." },
    { id: "pure", name: "Pure Blade", text: "Perfect parries and dodges only: a hit or an ordinary block ends the run." },
];
const FRENZY_SPEED = 1.33, MIGHT_LEVELS = 20;
const vowNames = (ids) => (ids || []).map((id) => (VOWS.find((vow) => vow.id == id) || { name: id }).name);
const LADDER_ROWS = 6;          // the board shows this many opponents of a longer gauntlet at a time

// The arenas: open ground near a bell. x, y, z: where you stand, facing yaw; the bosses arrive in front of you.
// A later form of a boss may have an arena of its own (phases: [{ arena }]): the run travels there between the two.
const ARENAS = [
    { id: "xigu_axe", name: "The Axemaster's Fall", map: "/Game/Maps/B02/PBZ_Xigu_WP", bell: "Bell_NLES_023", x: -50661, y: 260340, z: -24492, yaw: 216 },
    { id: "fuji_tree", name: "The Thread-Wrapped Giant Tree", map: "/Game/Maps/B03/PBZ_Fujizhilin_WP", bell: "Bell_LZSJ_010", x: 15588, y: 154245, z: -1963, yaw: 328 },
    { id: "pz_lake", name: "Meigu Lakeshore", map: "/Game/Maps/B08_09_10/PBZ_Pangzhen_WP", bell: "Bell_MGH_008", x: -67150, y: 80676, z: 805, yaw: 255 },
    // Huangxing's two halls. In the story the floor of the Lady's hall breaks under his first form and the fight
    // goes on in the hall below, which the game keeps as a copy far above the map (its spawner MBoss02_Seq094 at
    // -60085 -98792 10037551; game test: the journey there and the fight work).
    // Once he is beaten in the story the hall on the map has no floor in its middle: the floor is an actor of
    // its own, BP_Hall_Floor, which is gone then (game test: it stands in the copy at -60766 -101022 10038163,
    // turned 90, and is missing in the hall on the map). props: the mod puts a new one there for the fight.
    { id: "ddsd_hall", name: "The Lady's Hall", map: "/Game/Maps/DengDingShanDao/PBZ_DengDingShanDao_WP", bell: "Bell_DDSD_007", x: -60715, y: -99350, z: 29347, yaw: -90,
        props: [{ asset: "BP_Hall_Floor", x: -60766, y: -101022, z: 29859, yaw: 90 }] },
    { id: "ddsd_hall_below", name: "Beneath the Lady's Hall", map: "/Game/Maps/DengDingShanDao/PBZ_DengDingShanDao_WP", bell: "Bell_DDSD_007", x: -60085, y: -97300, z: 10037700, yaw: -90 },
    { id: "lyz_white", name: "Whiteshadow's Fall", map: "/Game/Maps/B08_09_10/PBZ_Pangzhen_WP", bell: "Bell_LYZ_014", x: -151389, y: -22294, z: 823, yaw: 23 },
    { id: "ddsd_blade", name: "The Commander's Platform", map: "/Game/Maps/DengDingShanDao/PBZ_DengDingShanDao_WP", bell: "Bell_DDSD_005", x: -62013, y: -58239, z: 18363, yaw: 89 },
    // Inside the Long pillar of the Mirrorwood, where the Gold-Masked One is fought: a place of its own, far above
    // the map (its music volume's middle is at -25509 154298 10028874, its own bell Bell_DP_002 at -26697 151251
    // 10028813, game data). You stand between that bell and the middle, facing the middle. The journey goes by
    // the pillar's outer bell, which is rung from outside; the bell inside is rung only by the fight itself.
    { id: "fuji_pillar", name: "Inside the Lóng Pillar", map: "/Game/Maps/B03/PBZ_Fujizhilin_WP", bell: "Bell_DP_002", x: -25836, y: 153459, z: 10028933, yaw: 69 },
    { id: "sz_shrine", name: "Ancestral Shrine Square", map: "/Game/Maps/B09/PBZ_Houjie_WP", bell: "Bell_SZ_023", x: -255090, y: 48762, z: -6172, yaw: 322 },
];
// A choice of place beside the arenas: each opponent is fought in its own arena (BOSSES[...].arena), with a
// journey between two fights where the arena changes. An opponent without a known arena comes to where you are.
const OWN_ARENAS = { own: true, name: "Each opponent's own arena" };
// The game's monster level curves and the attributes each one drives (current value too where a boss starts full).
const CURVE_PATH = (name) => `/PBZCombatAsset/Config/Level/CV_AttributeCurve_Monster_${name}.CV_AttributeCurve_Monster_${name}`;
const CURVES = { Health: ["Health_Max", "Health"], Attack: ["Attack"], Shachi: ["Shachi_Max", "Shachi"], ShachiAttack: ["ShachiAttack"], Infliction: ["Infliction_Max"] };
const LEVELS_PER_PLAYTHROUGH = 25, MAX_LEVEL = 200;
const ARRIVAL_RADIUS = 3000;    // cm: this near the spot counts as arrived
const TRAVEL_SETTLE_MS = 2000;  // the player must stand there this long, in control, before anything starts
const TRAVEL_MAX_MS = 120000;   // a journey that takes longer is given up

const CODEX_TABLE = "/Game/PBZContent/DataTable/DT_CodexEnemyDataTable.DT_CodexEnemyDataTable";
const FONT_FOLDER = "/Game/PBZContent/UI/Fonts";
const BELL_MENU_CLASS = "/Game/PBZContent/UI/InGame/Bell/W_BellMenu.W_BellMenu_C";
const BELL_ENTRY_TEXT = "Gauntlets", BELL_ENTRY_NEXT = "Gauntlet: next opponent";  // the second between two fights
const BELL_EVERY = 8;           // ticks between two looks at the bell menu (about 4 a second)
const TIP_CLASS = "/Game/PBZContent/UI/InGame/SwitchUI/WB_TipsText.WB_TipsText_C";
const HELPER_CLASS = "/Game/PBZContent/Blueprint/BP_GameplayHelper.BP_GameplayHelper_C";
const SMOKE = "/PBZVFXPack/VFX/BattleFX/Common/Jump/NS_Jump_Stone_301.NS_Jump_Stone_301";
const JUMP_ACTION = "/PBZInput/InputActions/IA_Jump.IA_Jump";
const NO_RECORD_TAG = "CharacterType.AI.ExcludeFromBossRecord";
const DEFLECT_EVENT = "GameplayEvent.Ability.Action.Deflect.Attacker";  // on the boss: .Perfect or .Normal
const HIT_EVENT = "GameplayEvent.Actor.Hit.Target";                     // on the one who is hit
const LIST_LENGTH = 10;
const RECORDS_FILE = "gauntlet_records.json";
const ZONES_FILE = "gauntlet_zones.json";   // the bosses' music volumes the mod has seen, see musicZones()
const OWN_ARENA_REACH = 15000;  // cm: a bell farther than this from the middle of a boss's music volume is not its arena
const GROUND_REACH = 300;       // cm up and down: walkable ground this near the player's height counts
const STAND_HEIGHT = 95;        // cm from the ground to the middle of a standing character
const SPOT_REACH = 25000;       // cm: a boss's own spot farther from you than this is not used
const GROUP_GAP = 420;          // cm between two members of a group as they arrive
const SPAWNER_HEIGHT = 100;     // cm: you arrive this far above a boss spawner's spot
const BELL_STAND = 220, BELL_HEIGHT = 120;  // cm: where you stand at a bell when the game names no spot: beside it, above its foot
const TITLE = "Gauntlet";
const HEALTH_FLOOR = 1;
const HIT_GAP_MS = 400;         // health that keeps dropping with shorter gaps than this is one hit
const TICK_MS = 33;

const log = (text) => console.log("[PBZMOD] [Gauntlet] " + text);
const gameInstance = puerts.argv.getByName("GameInstance");
if (!gameInstance)
    throw new Error("Gauntlet: the game instance is missing");

const key = (name) => { const k = new UE.Key(); k.KeyName = name; return k; };
const menuKey = key(SETTINGS.KEY), padHold = key(SETTINGS.PAD_HOLD), padPress = key(SETTINGS.PAD_PRESS);
const toText = (string) => UE.KismetTextLibrary.Conv_StringToText(string);
const player = () => UE.GameplayStatics.GetPlayerCharacter(gameInstance, 0);
const valid = (object) => { try { return !!object && UE.KismetSystemLibrary.IsValid(object); } catch (e) { return false; } };
const clock = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
const attempt = (what, action) => { try { return action(); } catch (e) { log(what + " failed: " + e); } };

let run = null;             // the run in progress, see begin()
let chosenVows = [];        // the ids of the vows chosen on the board: the next run takes them
let journey = null;         // travel in progress, to an arena or back: see travel()
let menu = null;            // the menu while it is open: see openMenu()
let bellMenuCount = 0;
let bell = null;            // the bell menu that has our entry: { menu, entry }
let openAfterBell = false;  // our entry was chosen: open the gauntlet menu once the bell menu has closed
let pending = null;         // a run is over and its result waits for the board: see showResult()
let effects = [];           // widget animations in progress: see animate()
let card = null;            // the name card on screen: { host, timer }
let ticks = 0;
const said = {};            // log lines that are written once
let wasDown = true;         // true also means "not seen up yet"
let asking = null, askingUntil = 0;
let jumpAction;             // undefined = not looked up yet, null = missing
let tip = null;             // the tip strip on screen: { widget, timer }
let ladder = null;          // the ladder on screen: { widgets, timer }
let slowTimer = null;
let errorSaid = false;

// ---------------------------------------------------------------------------------------------------------------
// What the player sees
// ---------------------------------------------------------------------------------------------------------------

// A line of text in the game's own tip strip, for some seconds.
function toast(text, seconds) {
    log("toast: " + text);
    attempt("toast", () => {
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
        attempt("toast fade in", () => widget.PlayAnimation(widget.FadeIn, 0, 1, 0, 1, false));
        const mine = { widget, timer: null };
        mine.timer = setTimeout(() => {
            attempt("toast fade out", () => valid(widget) && widget.PlayAnimation(widget.FadeOut, 0, 1, 0, 1, false));
            mine.timer = setTimeout(() => {
                if (valid(widget))
                    widget.RemoveFromParent();
                if (tip === mine)
                    tip = null;
            }, 600);
        }, (seconds || 3) * 1000);
        tip = mine;
    });
}

// One line of the ladder: the game's tip strip, moved, scaled and tinted.
function ladderLine(text, row, color) {
    const L = SETTINGS.LADDER;
    const pc = UE.GameplayStatics.GetPlayerController(gameInstance, 0);
    const widget = UE.WidgetBlueprintLibrary.Create(player(), UE.WidgetBlueprintGeneratedClass.Load(TIP_CLASS), pc);
    widget.AddToViewport(40);
    widget.SetText(toText(text));
    widget.SetRenderTranslation(new UE.Vector2D(L.X, L.Y + row * L.STEP));
    widget.SetRenderScale(new UE.Vector2D(L.SCALE, L.SCALE));
    widget.SetColorAndOpacity(color);
    attempt("ladder fade in", () => widget.PlayAnimation(widget.FadeIn, 0, 1, 0, 1, false));
    return widget;
}

function hideLadder() {
    if (!ladder)
        return;
    clearTimeout(ladder.timer);
    for (const widget of ladder.widgets)
        attempt("ladder removal", () => { if (valid(widget)) widget.RemoveFromParent(); });
    ladder = null;
}

// Shows the ladder of a run for some seconds: `fallen` opponents struck, the rest hidden.
function showLadder(gauntlet, fallen) {
    attempt("ladder", () => {
        hideLadder();
        const red = new UE.LinearColor(1, 0.22, 0.12, 1), white = new UE.LinearColor(1, 1, 1, 1), dim = new UE.LinearColor(1, 1, 1, 0.45);
        const widgets = [ladderLine(gauntlet.name, 0, white)];
        gauntlet.fights.forEach((id, i) => {
            widgets.push(i < fallen ? ladderLine("斩   " + BOSSES[id].name, i + 1.3, red)
                : ladderLine("？ ？ ？", i + 1.3, i == fallen ? white : dim));
        });
        const mine = { widgets, timer: null };
        mine.timer = setTimeout(() => {
            for (const widget of widgets)
                attempt("ladder fade out", () => valid(widget) && widget.PlayAnimation(widget.FadeOut, 0, 1, 0, 1, false));
            mine.timer = setTimeout(() => { if (ladder === mine) hideLadder(); }, 600);
        }, SETTINGS.LADDER.SECONDS * 1000);
        ladder = mine;
    });
}

// The game's own message box with an OK button.
function say(text) {
    log("box: " + text.replace(/\n/g, " | "));
    attempt("message box", () => UE.AsyncAction_ShowConfirmation.ShowConfirmationOk(player(), toText(TITLE), toText(text)).Activate());
}

// The game's own Yes / No box; answer(true) after a Yes. While it is open (at most 60 seconds) the key does nothing.
function ask(text, answer) {
    log("asked: " + text.replace(/\n/g, " | "));
    const action = UE.AsyncAction_ShowConfirmation.ShowConfirmationYesNo(player(), toText(TITLE), toText(text));
    asking = action; // kept so the box's answer finds its listener
    askingUntil = Date.now() + 60000;
    action.OnResult.Add((result) => {
        asking = null;
        askingUntil = 0;
        const yes = result == UE.ECommonMessagingResult.Confirmed;
        log("answer: " + (yes ? "yes" : "no"));
        setTimeout(() => attempt("answer", () => answer(yes)), 300); // after the box has closed
    });
    action.Activate();
}

// The game's boss-defeat banner.
function banner() {
    attempt("banner", () => puerts.blueprint.tojs(UE.Class.Load(HELPER_CLASS))["Push BossDeadUI"](false, player()));
}

// The game slows down for a moment, then runs on.
function slowMotion() {
    clearTimeout(slowTimer);
    attempt("slow motion", () => UE.GameplayStatics.SetGlobalTimeDilation(player(), SETTINGS.SLOW_MOTION));
    slowTimer = setTimeout(normalSpeed, SETTINGS.SLOW_MOTION_MS);
}

function normalSpeed() {
    clearTimeout(slowTimer);
    slowTimer = null;
    attempt("normal speed", () => UE.GameplayStatics.SetGlobalTimeDilation(player(), 1));
}

function smoke(at) {
    attempt("smoke", () => {
        const system = UE.Object.Load(SMOKE);
        if (system)
            UE.NiagaraFunctionLibrary.SpawnSystemAtLocation(player(), system, at, new UE.Rotator(0, 0, 0), new UE.Vector(3, 3, 3), true, true, 0, true);
    });
}

// ---------------------------------------------------------------------------------------------------------------
// Attributes and records
// ---------------------------------------------------------------------------------------------------------------

const attribute = (character, name) => character.AttributeSetBase[name].CurrentValue;

// Writes an attribute's base and current value. The struct is written back as a whole: a read gives a copy.
function setAttribute(character, name, value) {
    const set = character.AttributeSetBase;
    const data = set[name];
    data.BaseValue = value;
    data.CurrentValue = value;
    set[name] = data;
}

const filePath = (name) => UE.KismetSystemLibrary.ConvertToAbsolutePath(String(__dirname).replace(/[\\/]+$/, "") + "/" + name);
const recordsPath = () => filePath(RECORDS_FILE);

// The lists of wins, by gauntlet id: [{ time (ms), perfect, deflects, hits, rank, date }], fastest first.
function loadRecords() {
    const records = attempt("records read", () => {
        const path = recordsPath();
        if (!UE.BlueprintPathsLibrary.FileExists(path))
            return {};
        const out = puerts.$ref("");
        return UE.EasyCsv.LoadStringFromLocalFile(path, out) ? JSON.parse(puerts.$unref(out)) : {};
    }) || {};
    for (const id of Object.keys(records))
        if (!Array.isArray(records[id]) && id != PROGRESS && id != WON)
            delete records[id]; // the first version kept one time only
    records[PROGRESS] = records[PROGRESS] || {};
    records[WON] = records[WON] || {};
    return records;
}

function saveRecords(records) {
    attempt("records write", () => UE.EasyCsv.SaveStringToFileWithFullPath(JSON.stringify(records), recordsPath()));
}

// Under this key the records keep, by gauntlet id, how many of its opponents the player has ever beaten in a row.
const PROGRESS = "_progress";
// WON: gauntlet id -> true once it has been won. Kept apart from the list of best runs, so that a list can be
// deleted and the gauntlet stays won (and what it unseals stays open).
const WON = "_won";
const hasWon = (records, id) => (records[id] || []).length > 0 || !!(records[WON] || {})[id];

const rankOf = (hits) => hits == 0 ? "S" : hits <= 3 ? "A" : hits <= 8 ? "B" : "C";
const listLine = (entry, place) => `${place}.  ${clock(entry.time)}   Rank ${entry.rank}   ${entry.perfect} perfect parries   ${entry.hits} hits   ${entry.date}`;

// Listens for a game event on an actor, as the game's own health bar does; the returned object ends it.
function listen(actor, tagName, handler) {
    return attempt("listener " + tagName, () => {
        const tag = new UE.GameplayTag();
        tag.TagName = tagName;
        const task = UE.AbilityAsync_WaitGameplayEvent.WaitGameplayEventToActor(actor, tag, false, false);
        const received = (payload) => attempt("event " + tagName, () => handler(payload));
        task.EventReceived.Add(received);
        task.Activate();
        return { task, received };
    });
}

function unlisten(listener) {
    if (listener)
        attempt("listener end", () => {
            listener.task.EventReceived.Remove(listener.received);
            listener.task.EndAction();
        });
}

// ---------------------------------------------------------------------------------------------------------------
// Bosses
// ---------------------------------------------------------------------------------------------------------------

function isDead(actor) {
    if (!valid(actor))
        return true;
    try { return UE.SGameAIFunctionLibrary.IsDead(actor); } catch (e) { }
    try { return attribute(actor, "Health") <= 0; } catch (e) { return false; }
}

// Spawns a boss actor at a place, facing the player, without loot, codex entry or boss record. null when it fails.
function spawnBoss(boss, at) {
    const character = player();
    const bossClass = UE.Class.Load(boss.cls);
    if (!bossClass) {
        log("class not found: " + boss.cls);
        return null;
    }
    const me = character.K2_GetActorLocation();
    const yaw = Math.atan2(me.Y - at.Y, me.X - at.X) * 180 / Math.PI;
    const transform = UE.KismetMathLibrary.MakeTransform(at, new UE.Rotator(0, yaw, 0), new UE.Vector(1, 1, 1));
    const pending = UE.GameplayStatics.BeginDeferredActorSpawnFromClass(character, bossClass, transform,
        UE.ESpawnActorCollisionHandlingMethod.AdjustIfPossibleButAlwaysSpawn, null, 0);
    if (!pending) {
        log("spawn refused: " + boss.cls);
        return null;
    }
    attempt("codex exclusion", () => { pending.bExcludeFromCodex = true; });
    const actor = UE.GameplayStatics.FinishSpawningActor(pending, transform, 0);
    if (!valid(actor))
        return null;
    attempt("controller", () => { if (!valid(actor.Controller)) actor.SpawnDefaultController(); });
    attempt("loot removal", () => { if (valid(actor.LootComp)) actor.LootComp.K2_DestroyComponent(actor.LootComp); });
    attempt("record exclusion", () => {
        const tag = new UE.GameplayTag();
        tag.TagName = NO_RECORD_TAG;
        UE.AbilitySystemBlueprintLibrary.AddLooseGameplayTags(actor, UE.BlueprintGameplayTagLibrary.MakeGameplayTagContainerFromTag(tag), false);
    });
    smoke(at);
    const vows = run ? run.vows : [];
    scaleBoss(actor, boss.name, vows.includes("might") ? MIGHT_LEVELS : 0);
    if (vows.includes("frenzy"))
        attempt("frenzy", () => {
            actor.CustomTimeDilation = FRENZY_SPEED;
            actor.Mesh.GlobalAnimRateScale = FRENZY_SPEED;  // its moves themselves play faster
        });
    startMusic(boss);
    log(`spawned ${boss.name}: level ${attempt("level", () => attribute(actor, "Level"))}, health ${attempt("health", () => attribute(actor, "Health_Max"))}`);
    return actor;
}

// Brings a spawned boss to the strength of SETTINGS.BOSS_LEVEL with the game's own monster curves.
function scaleBoss(actor, name, extraLevels) {
    attempt("scaling", () => {
        const gameSystem = UE.SubsystemBlueprintLibrary.GetWorldSubsystem(player(), UE.PBZGameSystem.StaticClass());
        const playthrough = gameSystem ? gameSystem.GetCycleCount() : 0;
        const level = Math.min(MAX_LEVEL, SETTINGS.BOSS_LEVEL + LEVELS_PER_PLAYTHROUGH * playthrough + (extraLevels || 0));
        const parts = [];
        for (const curveName of Object.keys(CURVES)) {
            const curve = UE.Object.Load(CURVE_PATH(curveName));
            if (!curve) {
                parts.push(curveName + " curve missing");
                continue;
            }
            const factor = 1 + curve.GetFloatValue(level);
            for (const name of CURVES[curveName])
                attempt("scaling " + name, () => {
                    const set = actor.AttributeSetBase;
                    const data = set[name];
                    data.BaseValue *= factor;
                    data.CurrentValue *= factor;
                    set[name] = data;
                });
            parts.push(`${curveName} x${factor.toFixed(2)}`);
        }
        log(`${name} scaled to level ${level} (playthrough ${playthrough}): ${parts.join(", ")}; health now ${attribute(actor, "Health_Max")}, attack ${attribute(actor, "Attack")}`);
    });
}

// Boss music. In the game a boss's music belongs to the music volume around its arena: the volume names its
// enemies and the music state for the fight with each. A boss the mod spawns starts no music by itself (game
// test). So the mod looks through the music volumes that are loaded for one that names this boss, and asks the
// game's music system for that state. Away from the boss's own arena no such volume is loaded: there the mod
// plays the music it noted when it last saw the boss's volume (kept in the zones file).
const pathOf = (object) => object ? String(UE.KismetSystemLibrary.GetPathName(object)) : "";
function startMusic(boss) {
    attempt("music places", logPlaces); // notes the music volumes that are loaded here

    attempt("music", () => {
        const found = puerts.$ref(UE.NewArray(UE.Actor));
        UE.GameplayStatics.GetAllActorsOfClass(player(), UE.PBZMusicVolume.StaticClass(), found);
        const volumes = puerts.$unref(found);
        const wanted = boss.cls.split(".").pop().toLowerCase(), seen = [];
        let match = null;
        for (let i = 0; i < volumes.Num(); i++) {
            const volume = volumes.Get(i), names = [];
            for (let n = 0; n < volume.SpecificEnemyNames.Num(); n++) {
                const name = String(volume.SpecificEnemyNames.Get(n));
                names.push(name);
                if (!match && name && wanted.includes(name.toLowerCase()) && n < volume.SpecificMusicState_InCombat.Num())
                    match = { volume, state: volume.SpecificMusicState_InCombat.Get(n), name };
            }
            if (names.length && seen.length < 12)
                seen.push(`${UE.KismetSystemLibrary.GetObjectName(volume)} [${names.join(", ")}]`);
        }
        if (!said["music " + boss.cls])
            log(`music for ${wanted}: ${volumes.Num()} music volumes here; with enemy names: ${seen.join("; ") || "none"}; match: ${match ? match.name : "none"}`);
        said["music " + boss.cls] = true;
        let event = match && match.volume.SoundEvent, state = match && match.state, from = "its music volume here";
        if (!event || !state) {
            // Not in the boss's own arena: the music the mod noted when it saw the boss's volume (see logPlaces).
            const all = musicZones();
            const name = Object.keys(all).find((key) => key.length >= 4 && wanted.includes(key) && all[key].event && all[key].state);
            if (!name)
                return log(`no music for ${wanted}: its music volume is not here and has not been seen yet`);
            event = UE.Object.Load(all[name].event);
            state = UE.Object.Load(all[name].state);
            from = "the music noted for " + name;
            if (!event || !state)
                return log(`no music for ${wanted}: could not load ${all[name].event} / ${all[name].state}`);
        }
        const music = UE.SubsystemBlueprintLibrary.GetWorldSubsystem(player(), UE.MusicSubsystem.StaticClass());
        music.PlayMusicAndSetState(event, state, UE.EMusicType.CombatMusic, true);
        log(`music for ${wanted} started from ${from}: ${pathOf(event)} / ${pathOf(state)}`);
        if (run)
            run.music = true;
        // Whether the game kept the music or put its own back: one line for the log.
        const mine = run;
        setTimeout(() => attempt("music check", () => {
            if (run === mine && mine.music)
                log(`music check after 4 s: the game plays ${pathOf(music.CurPlayingEvent_Gameplay) || "nothing"}, combat music ${music.bIsPlayingCombatMusic}`);
        }), 4000);
    });
}

// Hands the music back to the game when the mod started it.
function stopMusic(ofRun) {
    if (!ofRun || !ofRun.music)
        return;
    ofRun.music = false;
    attempt("music end", () => UE.SubsystemBlueprintLibrary.GetWorldSubsystem(player(), UE.MusicSubsystem.StaticClass()).UpdateGameplayMusic(true));
}

// The place a boss appears: SPAWN_DISTANCE in front of the camera's view, at the player's height.
function arrivalPoint() {
    const character = player(), me = character.K2_GetActorLocation();
    let from = me, yaw;
    if (run && run.arena) {
        from = new UE.Vector(run.arena.x, run.arena.y, run.arena.z);
        yaw = run.arena.yaw;
    }
    else {
        const pc = UE.GameplayStatics.GetPlayerController(gameInstance, 0);
        yaw = pc && pc.PlayerCameraManager ? pc.PlayerCameraManager.GetCameraRotation().Yaw : character.K2_GetActorRotation().Yaw;
    }
    // The spot straight ahead may be a pit, a rock or thin air (game test: a boss fell into the trap beside a
    // bell). So the mod looks for walkable ground at the player's height: ahead first, then to the sides.
    const ahead = (turn) => {
        const angle = (yaw + turn) * Math.PI / 180;
        return new UE.Vector(from.X + Math.cos(angle) * SETTINGS.SPAWN_DISTANCE, from.Y + Math.sin(angle) * SETTINGS.SPAWN_DISTANCE, me.Z);
    };
    const found = attempt("ground", () => {
        for (const turn of [0, 35, -35, 70, -70, 110, -110, 180]) {
            const out = puerts.$ref(new UE.Vector(0, 0, 0));
            if (!UE.NavigationSystemV1.K2_ProjectPointToNavigation(character, ahead(turn), out, null, null, new UE.Vector(250, 250, GROUND_REACH)))
                continue;
            const ground = puerts.$unref(out);
            if (turn != 0)
                log(`arrival point: no walkable ground straight ahead, turned ${turn} degrees`);
            return new UE.Vector(ground.X, ground.Y, ground.Z + STAND_HEIGHT);
        }
        log("arrival point: no walkable ground around, using the spot straight ahead");
    });
    return found || new UE.Vector(ahead(0).X, ahead(0).Y, from.Z + 30);
}

// The boss's own spot: where the game's spawner for this boss stands (see logPlaces), when it is in this map,
// within SPOT_REACH of the player and its own boss does not stand there. { at, yaw } or null.
function bossSpot(bossId) {
    return attempt("boss spot", () => {
        const spot = (musicZones()._spawns || {})[bossId], character = player();
        const map = String(UE.KismetSystemLibrary.GetPathName(character)).split(".")[0];
        if (!spot || spot.d === undefined || spot.alive || spot.map != map)
            return null;
        const me = character.K2_GetActorLocation(), distance = Math.hypot(spot.x - me.X, spot.y - me.Y, spot.z - me.Z);
        if (distance > SPOT_REACH) {
            log(`the spot of ${bossId} is ${Math.round(distance / 100)} m away: too far, the opponent comes to you`);
            return null;
        }
        // The spawner may hang above or below the ground: the walkable ground at its place is where the boss stands.
        const out = puerts.$ref(new UE.Vector(0, 0, 0));
        const onGround = UE.NavigationSystemV1.K2_ProjectPointToNavigation(character, new UE.Vector(spot.x, spot.y, spot.z), out, null, null, new UE.Vector(300, 300, 600));
        const ground = onGround ? puerts.$unref(out) : new UE.Vector(spot.x, spot.y, spot.z);
        log(`${bossId} appears on its own spot, ${Math.round(distance / 100)} m from you (spawner ${spot.spawner}, at ${spot.x} ${spot.y} ${spot.z}, `
            + (onGround ? `walkable ground at height ${Math.round(ground.Z)})` : "no walkable ground found there)"));
        return { at: new UE.Vector(ground.X, ground.Y, ground.Z + STAND_HEIGHT), yaw: spot.yaw, distance };
    }) || null;
}

// ---------------------------------------------------------------------------------------------------------------
// Travel
// ---------------------------------------------------------------------------------------------------------------

const bellManager = () => UE.SubsystemBlueprintLibrary.GetWorldSubsystem(player(), UE.BellManager.StaticClass());

// The arenas the player may travel to: the ones whose bell is rung in this playthrough.
function openArenas() {
    return attempt("arena check", () => {
        const bells = bellManager();
        return ARENAS.filter((arena) => bells.IsBellActivated(arena.bell));
    }) || [];
}

// Where the player is now, as a place to come back to: map, spot and the player's bell. null when the map or
// the bell is not known (then no arena is offered: there would be no way back).
function here() {
    return attempt("origin", () => {
        const character = player();
        const map = String(UE.KismetSystemLibrary.GetPathName(character)).split(".")[0];
        const bells = bellManager();
        const bell = String(bells.SaveBellID || "") || String(bells.RecentlyInteractedBellID || "");
        const at = character.K2_GetActorLocation();
        log(`origin: map ${map}, bell "${bell}" (level of the bell: ${attempt("bell level", () => bells.GetLevelNameFromBellID(bell))})`);
        if (!map.startsWith("/Game/") || !bell || bell == "None")
            return null;
        return { name: "Starting place", map, bell, x: at.X, y: at.Y, z: at.Z, yaw: character.K2_GetActorRotation().Yaw };
    }) || null;
}

// Starts the game's own travel to a place ({ map, bell, x, y, z, yaw }); arrived() runs once the player stands
// there in control, failed() when the journey takes too long.
function travel(place, arrived, failed) {
    log(`travel to ${place.name}: ${place.map} ${place.x} ${place.y} ${place.z}, bell ${place.bell}`);
    journey = { place, arrived, failed, startedAt: Date.now(), thereSince: 0 };
    const saveLoad = UE.SubsystemBlueprintLibrary.GetGameInstanceSubsystem(gameInstance, UE.PBZSaveLoadSubsystem.StaticClass());
    const transform = UE.KismetMathLibrary.MakeTransform(new UE.Vector(place.x, place.y, place.z), new UE.Rotator(0, place.yaw, 0), new UE.Vector(1, 1, 1));
    try {
        saveLoad.TeleportTo(place.map, transform, place.bell);
    }
    catch (e) {
        journey = null; // no journey began: nothing to wait for
        throw e;
    }
}

function journeyTick(pc) {
    const now = Date.now();
    if (now - journey.startedAt > TRAVEL_MAX_MS) {
        const failed = journey.failed;
        journey = null;
        log("travel gave up");
        failed();
        return;
    }
    let there = false;
    try {
        const at = player().K2_GetActorLocation();
        const place = journey.place;
        there = Math.hypot(at.X - place.x, at.Y - place.y, at.Z - place.z) <= ARRIVAL_RADIUS && inGameplay(pc);
    }
    catch (e) { }   // no player while the map loads
    journey.thereSince = there ? journey.thereSince || now : 0;
    if (there && now - journey.thereSince >= TRAVEL_SETTLE_MS) {
        const arrived = journey.arrived;
        log(`arrived at ${journey.place.name} after ${clock(now - journey.startedAt)}`);
        journey = null;
        arrived();
    }
}

// A run is over: tells the player, after the way back when the run was at an arena.
function conclude(ended, text, soon) {
    const tell = () => { if (text) say(text); };
    if (!ended.origin) {
        setTimeout(tell, soon ? 300 : ended.won ? 4000 : 600);
        return;
    }
    setTimeout(() => attempt("way back", () => {
        toast("Returning …", 3);
        travel(ended.origin, tell, tell);
    }), soon ? 300 : ended.won ? 4500 : 1500);
}

// A run is won or lost: its result is shown on the board once the player is in control again (tick), and the
// way back follows when the board is closed. text: the same result in words, for the game's message box should
// the board fail.
function showResult(result) {
    result.at = Date.now() + (result.won ? SETTINGS.REVEAL_PAUSE_MS : 1200);
    pending = result;
}

function openResult(result) {
    try {
        openMenu(null, result);
    }
    catch (e) {
        log("the result board failed, using the message box: " + e);
        attempt("menu close", closeMenu);
        conclude(result.ended, result.text, true);
    }
}

// Where the game has its bosses. A boss's music volume lies around its arena and names it (game test: [PengMeng],
// [AHua]), so the mod notes each named volume it sees, by map, and keeps the notes in a file: the table grows
// with every map in which the board is opened. zone: enemy name in lower case -> { map, x, y, z } (the middle).
const SEEN_ZONES = {
    pengmeng: { map: "/Game/Maps/B02/PBZ_Xigu_WP", x: -52230, y: 258649, z: -22776 },
    ahua: { map: "/Game/Maps/B02/PBZ_Xigu_WP", x: -66113, y: 207102, z: -19392 },
};
let zones = null;
function musicZones() {
    if (!zones) {
        const kept = attempt("zones read", () => {
            const path = filePath(ZONES_FILE), out = puerts.$ref("");
            return UE.BlueprintPathsLibrary.FileExists(path) && UE.EasyCsv.LoadStringFromLocalFile(path, out) ? JSON.parse(puerts.$unref(out)) : {};
        });
        zones = Object.assign({}, SEEN_ZONES, kept || {});
    }
    return zones;
}

const samePlace = (a, b) => !!a && !!b && a.map == b.map && Math.hypot(a.x - b.x, a.y - b.y) < 1500;

// The maps by the level names the bell manager uses. The mod adds the map it is in whenever the board opens.
const LEVEL_MAPS = {
    PBZ_Xigu_WP: "/Game/Maps/B02/PBZ_Xigu_WP", PBZ_Fujizhilin_WP: "/Game/Maps/B03/PBZ_Fujizhilin_WP",
    PBZ_Pangzhen_WP: "/Game/Maps/B08_09_10/PBZ_Pangzhen_WP", PBZ_Houjie_WP: "/Game/Maps/B09/PBZ_Houjie_WP",
    PBZ_DengDingShanDao_WP: "/Game/Maps/DengDingShanDao/PBZ_DengDingShanDao_WP",
};
const mapOfLevel = (level) => LEVEL_MAPS[level] || (musicZones()._maps || {})[level] || registryMap(level);

// A level's map from the game's list of its own files, for the maps the mod has not been in (game test: Wan
// Jun's bell is in PBZ_Zhengdaodaying_WP, a map not listed above, so his fight stayed where the last one was).
// The list is read once: every asset under /Game/Maps, by name.
// The class of a blueprint by its asset's name, from the game's list of its files. Looked up once (the list of
// everything under /Game is long: the look takes a moment) and kept in the zones file.
function assetClass(name) {
    const all = musicZones();
    all._classes = all._classes || {};
    if (!all._classes[name]) {
        attempt("asset search", () => {
            const began = Date.now(), found = puerts.$ref(UE.NewArray(UE.AssetData));
            UE.AssetRegistryHelpers.GetAssetRegistry().GetAssetsByPath("/Game", found, true, false);
            const assets = puerts.$unref(found);
            for (let i = 0; i < assets.Num(); i++) {
                const path = String(assets.Get(i).PackageName);
                if (path.endsWith("/" + name)) {
                    all._classes[name] = `${path}.${name}_C`;
                    break;
                }
            }
            log(`asset ${name}: ${all._classes[name] || "not found"} (${assets.Num()} assets looked through in ${Date.now() - began} ms)`);
            if (all._classes[name])
                UE.EasyCsv.SaveStringToFileWithFullPath(JSON.stringify(all), filePath(ZONES_FILE));
        });
    }
    return all._classes[name] ? UE.Class.Load(all._classes[name]) : null;
}

// Puts an arena's props into the world (see ARENAS, props) and returns the actors made.
function placeProps(arena) {
    const made = [];
    for (const prop of arena.props || [])
        attempt("prop " + prop.asset, () => {
            const propClass = assetClass(prop.asset);
            if (!propClass)
                return log(`prop ${prop.asset}: its class was not found`);
            const transform = UE.KismetMathLibrary.MakeTransform(new UE.Vector(prop.x, prop.y, prop.z), new UE.Rotator(0, prop.yaw, 0), new UE.Vector(1, 1, 1));
            const pending = UE.GameplayStatics.BeginDeferredActorSpawnFromClass(player(), propClass, transform, UE.ESpawnActorCollisionHandlingMethod.AlwaysSpawn, null, 0);
            const actor = pending ? UE.GameplayStatics.FinishSpawningActor(pending, transform, 0) : null;
            if (!valid(actor))
                return log(`prop ${prop.asset}: not made`);
            made.push(actor);
            const parts = actor.K2_GetComponentsByClass(UE.StaticMeshComponent.StaticClass());
            log(`prop ${prop.asset} placed at ${prop.x} ${prop.y} ${prop.z}: ${parts.Num()} mesh parts`);
        });
    return made;
}

function removeProps(of) {
    for (const actor of of.props || [])
        attempt("prop removal", () => { if (valid(actor)) actor.K2_DestroyActor(); });
    of.props = null;
    openDoors(of);
}

// The fog doors of an arena. The game shuts an arena with fog doors while its boss is fought: actors whose class
// has "FogDoor" in its name, with the functions "Close By Mob Script" and "OpenByMobScript" (game test: the
// Lady's hall has a BP_FogDoorTotalBlock with them). The mod shuts those round the opponent once the player
// has come close to it, and opens them when the fight is over or the run moves on.
function closeDoors(around) {
    const doors = [];
    attempt("fog doors", () => {
        const found = puerts.$ref(UE.NewArray(UE.Actor));
        UE.GameplayStatics.GetAllActorsOfClass(player(), UE.Actor.StaticClass(), found);
        const actors = puerts.$unref(found);
        for (let i = 0; i < actors.Num(); i++) {
            const actor = actors.Get(i), kind = String(UE.KismetSystemLibrary.GetObjectName(actor.GetClass()));
            if (!/FogDoor/i.test(kind) || typeof actor["Close By Mob Script"] != "function")
                continue;
            const at = actor.K2_GetActorLocation(), distance = Math.hypot(at.X - around.X, at.Y - around.Y, at.Z - around.Z);
            if (distance > SETTINGS.FOG_DOOR_REACH)
                continue;
            attempt("fog door close", () => {
                actor["Close By Mob Script"]();
                doors.push(actor);
                log(`fog door shut: ${kind}, ${Math.round(distance / 100)} m from the opponent`);
            });
        }
        if (!doors.length)
            log("fog doors: none near this opponent");
    });
    return doors;
}

function openDoors(of) {
    for (const door of of.doors || [])
        attempt("fog door open", () => { if (valid(door)) door.OpenByMobScript(); });
    of.doors = null;
}

let registryMaps = null;
function registryMap(level) {
    if (!registryMaps) {
        registryMaps = {};
        attempt("map list", () => {
            const found = puerts.$ref(UE.NewArray(UE.AssetData));
            UE.AssetRegistryHelpers.GetAssetRegistry().GetAssetsByPath("/Game/Maps", found, true, false);
            const assets = puerts.$unref(found);
            for (let i = 0; i < assets.Num(); i++) {
                const name = String(assets.Get(i).AssetName), path = String(assets.Get(i).PackageName);
                if (path.split("/").pop() == name && !registryMaps[name])
                    registryMaps[name] = path;
            }
            log(`map list: ${assets.Num()} assets under /Game/Maps, ${Object.keys(registryMaps).length} maps by name`);
        });
    }
    const map = registryMaps[level] || null;
    if (!said["map of " + level]) {
        said["map of " + level] = true;
        log(`map of ${level}: ${map || "not found in the game's list"}`);
    }
    return map;
}

// A rung bell as an arena: you arrive where the game itself puts a traveller to that bell (the bell's place plus
// its teleport offset), looking away from the bell, so the opponent arrives on open ground. null: the bell is
// not rung in this playthrough, or its map is not known yet.
const bellArenas = {};
function bellArena(id) {
    const bells = bellManager();
    if (!bells.IsBellActivated(id))
        return null;
    const map = mapOfLevel(String(bells.GetLevelNameFromBellID(id)));
    if (!map)
        return null;
    if (!bellArenas[id]) {
        const at = bells.GetBellLocationFromBellID(id), offset = bells.GetTeleportOffsetFromBellID(id), turn = bells.GetTeleportRotationFromBellID(id);
        const aside = Math.hypot(offset.X, offset.Y) > 30;  // the game gives a spot beside the bell
        const name = attempt("bell name", () => UE.KismetTextLibrary.Conv_TextToString(UE.EventPipelineManager.Conv_LocTextToText(bells.GetBellNameFromBellID(id))));
        bellArenas[id] = { id: "bell " + id, name: String(name || id), map, bell: id,
            x: at.X + (aside ? offset.X : BELL_STAND), y: at.Y + (aside ? offset.Y : 0), z: at.Z + Math.max(offset.Z, BELL_HEIGHT),
            yaw: aside ? Math.atan2(offset.Y, offset.X) * 180 / Math.PI : turn.Yaw };
        log(`bell arena ${id} "${bellArenas[id].name}": bell at ${Math.round(at.X)} ${Math.round(at.Y)} ${Math.round(at.Z)}, teleport offset ${Math.round(offset.X)} ${Math.round(offset.Y)} ${Math.round(offset.Z)}, rotation ${Math.round(turn.Yaw)}`);
    }
    return bellArenas[id];
}

// The arena of a boss, the first of these that is open in this playthrough:
// - its hand-written arena (BOSSES[...].arena);
// - the bell the guides name beside the fight (BOSSES[...].bell);
// - the rung bell nearest to the middle of the boss's music volume, when the mod has seen that volume.
// null: none of these: the boss comes to where you are.
function ownArena(bossId) {
    const boss = BOSSES[bossId];
    if (boss.group && !boss.arena)
        return null;    // a group without a written arena comes to where you are
    const real = boss.group ? null : attempt("spawner arena", () => spawnerArena(bossId));
    if (real)
        return real;
    const written = boss.arena && openArenas().find((arena) => arena.id == boss.arena);
    if (written)
        return written;
    return attempt("own arena", () => {
        if (boss.group)
            return null;    // its written arena's bell is not rung
        const named = boss.bell && bellArena(boss.bell);
        if (named)
            return named;
        const wanted = boss.cls.split(".").pop().toLowerCase(), all = musicZones();
        const key = Object.keys(all).filter((name) => !name.startsWith("_") && wanted.includes(name)).sort((a, b) => b.length - a.length)[0];
        if (!key)
            return null;
        const near = nearestBell(all[key].map, all[key].x, all[key].y);
        return near && near.distance <= OWN_ARENA_REACH ? bellArena(near.id) : null;
    }) || null;
}

// The rung bell of a map that is nearest to a spot: { id, distance }, or null when no bell of that map is rung.
function nearestBell(map, x, y) {
    const level = map.split("/").pop(), bells = bellManager(), ids = bells.GetAllActivateBellIDs();
    let near = null;
    for (let i = 0; i < ids.Num(); i++) {
        const id = ids.Get(i);
        if (String(bells.GetLevelNameFromBellID(id)) != level)
            continue;
        const at = bells.GetBellLocationFromBellID(id), distance = Math.hypot(at.X - x, at.Y - y);
        if (!near || distance < near.distance)
            near = { id: String(id), distance };
    }
    return near;
}

// The boss's real arena: the place of the game's own spawner for this boss, which the mod notes when it sees it
// (logPlaces). You arrive on the boss's spot, looking the way the boss looks; the opponent appears in front of
// you. null: the spawner has not been seen, its boss still stands there in this playthrough, or the map has no
// rung bell (the game's travel needs one).
function spawnerArena(bossId) {
    const spot = (musicZones()._spawns || {})[bossId];
    if (!SETTINGS.INTO_ARENA || !spot || spot.alive)
        return null;
    const near = nearestBell(spot.map, spot.x, spot.y);
    if (!near)
        return null;
    const bell = near.distance <= OWN_ARENA_REACH ? bellArena(near.id) : null;
    return { id: "spawner " + bossId, name: bell ? bell.name : "Arena: " + BOSSES[bossId].name, map: spot.map, bell: near.id,
        x: spot.x, y: spot.y, z: spot.z + SPAWNER_HEIGHT, yaw: spot.yaw, spawner: true };
}

// Travels to a boss's arena. On arrival near the arena the game has loaded the boss's spawner: when the mod sees
// it there for the first time, one more short journey takes the player from the bell into the arena itself.
function travelInto(bossId, place, arrived, failed) {
    travel(place, () => {
        attempt("places on arrival", logPlaces);
        const better = place.spawner ? null : ownArena(bossId);
        if (better && better.spawner && !samePlace(better, place)) {
            log(`the spawner of ${bossId} is known now: on into the arena`);
            try {
                travel(better, () => arrived(better), () => arrived(null));
                return;
            }
            catch (e) {
                log("the second journey could not begin: " + e);
            }
        }
        arrived(place);
    }, failed);
}

// Starts a gauntlet at an arena (after the journey there) or, with no arena, where the player stands.
function start(gauntlet, arena) {
    if (!arena) {
        begin(gauntlet, null, null);
        return;
    }
    const origin = here();
    if (!origin) {
        say("There is no way back from here (no bell found). Rest at a bell and try again, or fight right here.");
        return;
    }
    if (arena.own) {
        const first = ownArena(gauntlet.fights[0]);
        if (!first) {
            begin(gauntlet, null, origin, true);
            return;
        }
        toast(`${first.name} …`, 3);
        travelInto(gauntlet.fights[0], first, (place) => begin(gauntlet, place || first, origin, true),
            () => say(`The journey to “${first.name}” failed. You are where the game put you.`));
        return;
    }
    toast(`${arena.name} …`, 3);
    travel(arena, () => begin(gauntlet, arena, origin),
        () => say(`The journey to “${arena.name}” failed. You are where the game put you.`));
}

// ---------------------------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------------------------

// The hits the player took: the drops of the player's health.
const hitsOf = (r) => r.healthDrops;
const runTime = (r) => (r.endedAt || Date.now()) - r.startedAt - r.idleMs;
const tally = (r) => `${r.perfect} perfect parries, ${hitsOf(r)} hits`;

function begin(gauntlet, arena, origin, own) {
    const character = player();
    run = {
        gauntlet,
        own: !!own,             // each opponent is fought in its own arena where the mod knows it
        moved: !!arena,         // a journey took the player away from where the run was started
        arena,                  // the arena the run is fought at, or null: where the player stands
        origin,                 // the place to travel back to afterwards, or null
        won: false,
        fight: -1,              // index into gauntlet.fights
        steps: [],              // the current fight's actors in order: the boss, then its later phases
        step: 0,
        actor: null,            // the boss actor alive now (of a group: its first member)
        actors: [],             // all actors of the fight in progress: one boss, or the members of a group
        vows: chosenVows.slice(),   // the vows taken for this run, see VOWS
        lastPlace: null,        // where the last boss fell
        state: "pause",         // "pause" (waiting for the next arrival), "fight", "stop" (a fight is won: the
                                // board opens and the player calls the next opponent) or "travel" (on the way
                                // to the next opponent's arena)
        music: false,           // the mod started the boss's music
        nextAt: Date.now() + 2500,
        startedAt: Date.now(),
        fightStartedAt: 0,
        who: UE.KismetSystemLibrary.GetPathName(character),
        floorBefore: attribute(character, "Health_Min"),
        spawned: [],
        perfect: 0, deflects: 0,    // the player's perfect and normal deflects
        hitEvents: 0, healthDrops: 0, lastHealth: 0, lastDropAt: 0,
        idleMs: 0,              // time spent at the board between fights: not part of the run's time
        rests: 0,               // how often the player rested between fights
        listeners: [],
    };
    const mine = run;
    run.listeners.push(listen(character, HIT_EVENT, () => { mine.hitEvents++; }));
    setAttribute(character, "Health_Min", HEALTH_FLOOR);
    setAttribute(character, "Health", attribute(character, "Health_Max"));
    run.lastHealth = attribute(character, "Health");
    log(`run started: ${gauntlet.id}, vows [${run.vows}], health floor ${run.floorBefore} -> ${attribute(character, "Health_Min")}, health ${attribute(character, "Health")}`);
    run.nextAt = Date.now() + 1500;
    loadSounds();   // the drum of the first opponent's name card
}

// Ends the run: bosses away, the player's health floor back and health full. No message.
function finish() {
    if (!run)
        return;
    const ended = run;
    run = null;
    ended.endedAt = Date.now();
    if (!ended.moved)
        ended.origin = null;    // the run never left the place it began: no way back to travel
    stopMusic(ended);
    normalSpeed();
    ended.listeners.forEach(unlisten);
    if (!ended.won && ended.fight + 1 < ended.gauntlet.fights.length)
        hideLadder();
    log(`counted: ${ended.perfect} perfect deflects, ${ended.deflects} normal deflects, ${ended.hitEvents} hit events, ${ended.healthDrops} health drops`);
    for (const actor of ended.spawned)
        attempt("boss removal", () => { if (valid(actor) && !isDead(actor)) actor.K2_DestroyActor(); });
    removeProps(ended);
    attempt("player restore", () => {
        const character = player();
        if (character && UE.KismetSystemLibrary.GetPathName(character) == ended.who) {
            setAttribute(character, "Health_Min", ended.floorBefore);
            setAttribute(character, "Health", attribute(character, "Health_Max"));
            log(`player restored: health floor ${attribute(character, "Health_Min")}, health ${attribute(character, "Health")}`);
        }
    });
    return ended;
}

// The next actor of the run arrives: the next phase of the current boss, or the next boss.
function arrive() {
    const fights = run.gauntlet.fights;
    if (run.step + 1 < run.steps.length) {
        run.step++;
    }
    else {
        run.fight++;
        const boss = BOSSES[fights[run.fight]];
        run.steps = [boss].concat(boss.phases || []);
        run.step = 0;
        run.fightStartedAt = Date.now();
    }
    const boss = run.steps[run.step];
    // A boss in its own arena stands on its own spot, as in the game, and waits for you there.
    const spot = run.own && run.arena && run.step == 0 && !boss.group ? bossSpot(fights[run.fight]) : null;
    const place = run.step > 0 && run.lastPlace ? run.lastPlace : spot ? spot.at : arrivalPoint();
    // A group arrives side by side, GROUP_GAP apart, across the line from the player to the place.
    const members = boss.group ? boss.group.map((id) => BOSSES[id]) : [boss];
    const me = player().K2_GetActorLocation(), away = Math.atan2(place.Y - me.Y, place.X - me.X) + Math.PI / 2;
    const actors = [], homes = [];
    members.forEach((member, i) => {
        const aside = (i - (members.length - 1) / 2) * GROUP_GAP;
        const at = new UE.Vector(place.X + Math.cos(away) * aside, place.Y + Math.sin(away) * aside, place.Z);
        const actor = spawnBoss(member, at);
        if (actor) {
            actors.push(actor);
            run.spawned.push(actor);
            homes.push({ actor, x: at.X, y: at.Y, z: at.Z, name: member.name });
        }
    });
    if (actors.length < members.length) {
        const ended = finish();
        conclude(ended, `${boss.name} could not appear. The run “${ended.gauntlet.name}” has ended.`);
        return;
    }
    run.actor = actors[0];
    run.actors = actors;
    run.extras = [];
    run.watchAt = Date.now() + 2000;    // the log follows the opponent for a while, see runTick
    run.watched = 0;
    run.homes = homes;                  // where each actor was put: see keepHome
    run.arrivedAt = Date.now();
    if (spot)
        toast(`${boss.name} awaits you in the arena, ${Math.round(spot.distance / 100)} m from here`, 6);
    const mine = run;
    for (const actor of actors)
        run.listeners.push(listen(actor, DEFLECT_EVENT, (payload) => {
            const name = String(payload && payload.EventTag ? payload.EventTag.TagName : "");
            if (name.endsWith(".Perfect"))
                mine.perfect++;
            else if (name.endsWith(".Normal")) {
                mine.deflects++;
                if (mine.vows.includes("pure"))
                    mine.broken = "Pure Blade";   // the run ends at the next tick, see runTick
            }
        }));
    run.state = "fight";
    try {
        showCard(run.step > 0 ? "NEXT PHASE" : `FIGHT ${run.fight + 1} OF ${fights.length}`,
            run.step > 0 ? boss.name : faceOf(fights[run.fight]).name);
    }
    catch (e) {
        log("the name card failed, using the tip strip: " + e);
        toast(run.step > 0 ? boss.name : `Fight ${run.fight + 1} of ${fights.length} — ${boss.name}`, 4);
    }
}

// Riders. A boss on horseback brings its own mount: its AI script makes the horse and seats the rider on it
// (game test: Jing Ye). Away from its own spawner that horse appears at the map's origin, and the rider, attached
// to it, goes there with it. So for the first seconds after a boss arrives the mod looks where it is; when it is
// far from where it was put, its mount is brought there and the rider comes with it. The rider itself is not
// moved while it has a mount: it would keep its new distance from the horse and float beside it (game test).
// A boss without a mount that moved itself away is brought back itself.
const HOME_MS = 6000, HOME_REACH = 1500;
const DRIVER_CLASS = "/SGameDriver/BP_SGameDriverComponent.BP_SGameDriverComponent_C";
function keepHome() {
    if (!run.homes || Date.now() - run.arrivedAt > HOME_MS)
        return;
    for (const home of run.homes) attempt("home", () => {
        if (!valid(home.actor) || isDead(home.actor))
            return;
        if (home.driver === undefined)
            home.driver = home.actor.GetComponentByClass(UE.Class.Load(DRIVER_CLASS)) || null;
        const mount = home.driver && valid(home.driver.DrivingVehicle) ? home.driver.DrivingVehicle : null;
        if (mount && home.mount !== mount) {
            home.mount = mount;
            run.spawned.push(mount);    // leaves with the run
            run.extras.push(mount);     // and when its rider has fallen
            log(`${home.name} rides ${UE.KismetSystemLibrary.GetObjectName(mount)} (seat ${home.driver.CurrentSeat})`);
            scaleBoss(mount, home.name + ": mount", run.vows.includes("might") ? MIGHT_LEVELS : 0);
        }
        if (home.driver && !mount && Date.now() - run.arrivedAt < HOME_MS - 1000)
            return;     // a rider whose mount is not there yet: wait for it
        const subject = mount || home.actor;
        const at = subject.K2_GetActorLocation(), away = Math.hypot(at.X - home.x, at.Y - home.y, at.Z - home.z);
        if (away <= HOME_REACH)
            return;
        const me = player().K2_GetActorLocation();
        const facing = new UE.Rotator(0, Math.atan2(me.Y - home.y, me.X - home.x) * 180 / Math.PI, 0);
        const moved = subject.K2_TeleportTo(new UE.Vector(home.x, home.y, home.z), facing);
        log(`${home.name}${mount ? ": its mount" : ""} was ${Math.round(away / 100)} m away (at ${Math.round(at.X)} ${Math.round(at.Y)} ${Math.round(at.Z)}): brought to its place ${moved}`);
    });
}

// The boss alive now has fallen.
function fallen() {
    const fights = run.gauntlet.fights;
    const boss = run.steps[run.step];
    attempt("fall place", () => { run.lastPlace = run.actor.K2_GetActorLocation(); });
    for (const extra of run.extras || [])
        attempt("extra removal", () => { if (valid(extra) && !isDead(extra)) extra.K2_DestroyActor(); });
    run.extras = [];
    run.actor = null;
    const lastStep = run.step + 1 >= run.steps.length;
    log(`${boss.name} fell` + (lastStep ? `, fight ${run.fight + 1} done in ${clock(Date.now() - run.fightStartedAt)}` : ", next phase"));
    if (!lastStep) {
        const next = run.steps[run.step + 1], arena = next.arena && openArenas().find((open) => open.id == next.arena);
        if (arena && run.own) {
            log(`the next form is fought at ${arena.name}`);
            run.lastPlace = null;   // the next form arrives in front of the player there
            run.state = "travel";   // nothing else happens until the journey: the fall is seen first
            run.nextAt = Number.MAX_SAFE_INTEGER;   // no arrival before the journey is over (it sets the time anew)
            const moving = run, bossId = fights[run.fight];
            setTimeout(() => {
                if (run === moving)
                    attempt("journey to the next form", () => moveRun(moving, arena, bossId));
            }, 2500);
            return;
        }
        run.state = "pause";
        run.nextAt = Date.now() + 1500;
        return;
    }
    stopMusic(run);
    openDoors(run);
    slowMotion();
    if (!boss.ownBanner)
        banner();
    const gauntlet = run.gauntlet, count = run.fight + 1;
    const progress = loadRecords();
    if (count > (progress[PROGRESS][gauntlet.id] || 0)) {
        progress[PROGRESS][gauntlet.id] = count;
        saveRecords(progress);
    }
    if (run.fight + 1 < fights.length) {
        run.state = "stop";
        run.told = false;
        run.stopAt = Date.now();    // from here to the call of the next opponent the run's clock stands
        run.nextAt = Date.now() + SETTINGS.REVEAL_PAUSE_MS;
        return;
    }
    // The last boss: the gauntlet is beaten.
    const ended = finish();
    ended.won = true;
    const entry = { time: runTime(ended), rests: ended.rests, perfect: ended.perfect, deflects: ended.deflects, hits: hitsOf(ended), vows: ended.vows,
        rank: rankOf(hitsOf(ended)), date: new Date().toISOString().slice(0, 10) };
    const records = loadRecords();
    const list = (records[ended.gauntlet.id] || []).concat([entry]).sort((x, y) => x.time - y.time).slice(0, LIST_LENGTH);
    records[ended.gauntlet.id] = list;
    records[WON][ended.gauntlet.id] = true;
    saveRecords(records);
    const place = list.indexOf(entry) + 1;
    showResult({ ended, won: true, entry, place, list, text: `${ended.gauntlet.name} conquered — Rank ${entry.rank}\n\n`
        + `Time ${clock(entry.time)}   ·   ${entry.perfect} perfect parries   ·   ${entry.deflects} parries   ·   ${entry.hits} hits\n`
        + (place == 1 ? "New best time!" : place ? `Place ${place} among the best runs` : "Not among the best ten") + "\n\n"
        + list.slice(0, 5).map((e, i) => listLine(e, i + 1)).join("\n") });
}

// The player's health reached the floor: the run is lost.
function lost() {
    const fights = run.gauntlet.fights;
    const boss = run.steps[run.step];
    if (run.broken)
        log(`vow broken: ${run.broken}`);
    const text = (run.broken ? `Vow broken: ${run.broken}.
` : "") + `Fallen in fight ${run.fight + 1} of ${fights.length}, to ${boss.name}.\n\nTime ${clock(runTime(run))}   ·   ${tally(run)}`;
    const ended = finish();
    showResult({ ended, won: false, text: `${ended.gauntlet.name}\n\n${text}` });
}

function runTick() {
    const character = player();
    if (!character || UE.KismetSystemLibrary.GetPathName(character) != run.who) {
        log("the player object changed: run dropped");
        finish();
        return;
    }
    // An arena's props are put up as soon as the player stands there, before the opponent arrives.
    if (run.state != "travel" && run.arena && run.arena.props && !run.props) {
        const at = character.K2_GetActorLocation();
        if (Math.hypot(at.X - run.arena.x, at.Y - run.arena.y, at.Z - run.arena.z) < 15000)
            run.props = placeProps(run.arena);
    }
    const health = attribute(character, "Health");
    if (health < run.lastHealth - 0.5) {
        if (Date.now() - run.lastDropAt > HIT_GAP_MS)
            run.healthDrops++;
        run.lastDropAt = Date.now();
        if (run.state == "fight" && run.vows.includes("pure"))
            run.broken = "Pure Blade";    // a hit breaks the vow like a block that is not perfect
    }
    run.lastHealth = health;
    if (health <= HEALTH_FLOOR + 0.5 || run.broken) {
        lost();
        return;
    }
    // The arena shuts once the player has come close to the opponent in its own arena.
    if (SETTINGS.FOG_DOORS && run.state == "fight" && run.own && run.arena && !run.doors && valid(run.actor)) {
        const me = character.K2_GetActorLocation(), it = run.actor.K2_GetActorLocation();
        if (Math.hypot(me.X - it.X, me.Y - it.Y, me.Z - it.Z) < 1500)
            run.doors = closeDoors(it);
    }
    if (run.state == "fight") {
        // Raserei: the game's slow-motion system sets an actor's time dilation itself (hit stop, bullet time) and
        // puts it back to 1 afterwards; whenever it stands at 1 the mod raises it again.
        if (run.vows.includes("frenzy")) attempt("frenzy", () => {
            for (const actor of run.actors) {
                if (!valid(actor) || isDead(actor))
                    continue;
                const now = actor.CustomTimeDilation;
                if (!said.frenzy && Date.now() - run.fightStartedAt > 1500) {
                    said.frenzy = true;
                    log(`frenzy check: time dilation ${now}, animation rate ${actor.Mesh.GlobalAnimRateScale}`);
                }
                if (Math.abs(now - 1) < 0.001)
                    actor.CustomTimeDilation = FRENZY_SPEED;
            }
        });
        keepHome();
        // Where the opponent is, for the log: six times in the first half minute of a fight.
        if (run.watched < 6 && Date.now() >= run.watchAt) attempt("watch", () => {
            run.watched++;
            run.watchAt = Date.now() + 5000;
            const actor = run.actor, at = actor.K2_GetActorLocation(), me = character.K2_GetActorLocation();
            log(`opponent watch ${run.watched}: valid ${valid(actor)}, at ${Math.round(at.X)} ${Math.round(at.Y)} ${Math.round(at.Z)}, `
                + `${Math.round(Math.hypot(at.X - me.X, at.Y - me.Y, at.Z - me.Z) / 100)} m from you, hidden ${actor.bHidden}, `
                + `health ${attribute(actor, "Health")}, controller ${valid(actor.Controller)}, you at ${Math.round(me.X)} ${Math.round(me.Y)} ${Math.round(me.Z)}`);
        });
        if (run.actors.every(isDead))
            fallen();
    }
    else if (run.state == "stop") {
        // The player is free now, as at the idol that appears after a boss in Sekiro: the board with the next
        // opponent opens from a bell's menu or with the key (tick). Once the defeat banner has played, a card says so.
        if (!run.told && Date.now() >= run.nextAt && inGameplay(UE.GameplayStatics.GetPlayerController(gameInstance, 0))) {
            run.told = true;
            attempt("stop card", () => showCard("OPPONENT DEFEATED", `Next opponent: at a bell or with ${SETTINGS.KEY}`, 5000));
        }
    }
    else if (Date.now() >= run.nextAt) {
        arrive();
    }
}

// ---------------------------------------------------------------------------------------------------------------
// The key
// ---------------------------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------------------------------------------

const rgba = (r, g, b, a) => new UE.LinearColor(r, g, b, a === undefined ? 1 : a);
const vec = (x, y) => new UE.Vector2D(x, y);
const make = (type) => UE.NewObject(type.StaticClass());

// The game's codex entries by boss class path (lower case): { name (the game's text), icon, art }. Read once.
let codex = null;
function codexEntries() {
    if (codex)
        return codex;
    codex = new Map();
    attempt("codex", () => {
        const table = UE.DataTable.Load(CODEX_TABLE);
        const namesRef = puerts.$ref(UE.NewArray(UE.BuiltinName));
        UE.DataTableFunctionLibrary.GetDataTableRowNames(table, namesRef);
        const names = puerts.$unref(namesRef);
        for (let i = 0; i < names.Num(); i++) {
            const row = new UE.CodexEnemyRow();
            if (!UE.DataTableFunctionLibrary.Generic_GetDataTableRowFromName(table, names.Get(i), row))
                continue;
            if (!UE.KismetSystemLibrary.IsValidSoftClassReference(row.EnemyClass))
                continue;
            const path = String(UE.KismetSystemLibrary.Conv_SoftClassReferenceToString(row.EnemyClass)).toLowerCase();
            const soft = (texture) => UE.KismetSystemLibrary.IsValidSoftObjectReference(texture) ? texture : null;
            const entry = { name: UE.EventPipelineManager.Conv_LocTextToText(row.EnemyName), icon: soft(row.WhiteIcon),
                art: soft(row.HalfBodyTexture) || soft(row.HighPrecisionTexture) };
            codex.set(path, entry);
            // An entry can stand for other classes too (another form of the same enemy).
            attempt("codex aliases", () => {
                for (let a = 0; a < row.AliasEnemyClasses.Num(); a++) {
                    const alias = String(UE.KismetSystemLibrary.Conv_SoftClassReferenceToString(row.AliasEnemyClasses.Get(a))).toLowerCase();
                    if (alias && !codex.has(alias))
                        codex.set(alias, entry);
                }
            });
        }
        log(`codex: ${codex.size} entries`);
        // The whole codex as a list (name | class), beside the mod: to look up which class an enemy of the game is.
        attempt("codex list", () => {
            const lines = [];
            codex.forEach((entry, path) => lines.push(`${UE.KismetTextLibrary.Conv_TextToString(entry.name)} | ${path}`));
            UE.EasyCsv.SaveStringToFileWithFullPath(lines.sort().join(String.fromCharCode(10)), filePath("gauntlet_codex.txt"));
        });
    });
    return codex;
}

// What the screen shows of a boss: the game's own name and pictures where the codex has it, else our name.
function faceOf(bossId) {
    const boss = BOSSES[bossId];
    if (boss.group)     // a group shows its last member's picture under its own name
        return Object.assign(faceOf(boss.group[boss.group.length - 1]), { name: toText(boss.name) });
    // The boss's own entry, else the entry of one of its later phases.
    const entry = [boss].concat(boss.phases || []).map((form) => codexEntries().get(form.cls.toLowerCase())).find((found) => found);
    if (!entry && !said["face " + bossId]) {
        said["face " + bossId] = true;
        log(`codex: no entry for ${boss.cls}`);
    }
    return { name: entry ? entry.name : toText(boss.name), icon: entry ? entry.icon : null, art: entry ? entry.art || entry.icon : null };
}

// One of the game's own fonts for the screen's text (a German one first); null: the engine's default font.
let screenFont;
function gameFont() {
    if (screenFont !== undefined)
        return screenFont;
    screenFont = null;
    attempt("font", () => {
        const found = puerts.$ref(UE.NewArray(UE.AssetData));
        UE.AssetRegistryHelpers.GetAssetRegistry().GetAssetsByPath(FONT_FOLDER, found, true, false);
        const assets = puerts.$unref(found), fonts = [];
        for (let i = 0; i < assets.Num(); i++) {
            const asset = assets.Get(i);
            if (String(asset.AssetClassPath.AssetName) == "Font")
                fonts.push(`${asset.PackageName}.${asset.AssetName}`);
        }
        log(`fonts in the game: ${fonts.join(", ")}`);
        const pick = fonts.find((f) => /german|vollkorn/i.test(f)) || fonts.find((f) => /alverata|title/i.test(f)) || fonts[0];
        screenFont = pick ? UE.Object.Load(pick) || null : null;
        log(`font used: ${screenFont ? pick : "the engine's default"}`);
    });
    return screenFont;
}

// Puts a widget on a canvas at x, y with a size (no size: its own) and a layer.
function place(canvas, widget, x, y, w, h, z) {
    const slot = canvas.AddChildToCanvas(widget);
    slot.SetPosition(vec(x, y));
    if (w)
        slot.SetSize(vec(w, h));
    else
        slot.SetAutoSize(true);
    slot.SetZOrder(z || 0);
    return widget;
}

// A plain coloured rectangle.
function block(canvas, x, y, w, h, color, z) {
    const image = make(UE.Image);
    image.SetColorAndOpacity(color);
    return place(canvas, image, x, y, w, h, z);
}

// A picture from the game, fitted into a box without stretching it.
function picture(canvas, texture, x, y, w, h, z, tint) {
    const fit = make(UE.ScaleBox), image = make(UE.Image);
    fit.SetStretch(2); // EStretch: ScaleToFit
    image.SetBrushFromSoftTexture(texture, true);
    if (tint)
        image.SetColorAndOpacity(tint);
    fit.AddChild(image);
    return place(canvas, fit, x, y, w, h, z);
}

// A line of text: a string, or one of the game's own texts.
function label(canvas, text, x, y, size, color, z) {
    const block = make(UE.TextBlock);
    block.SetText(typeof text == "string" ? toText(text) : text);
    const font = block.Font;
    font.Size = size;
    if (gameFont())
        font.FontObject = gameFont();
    block.SetFont(font);
    const tone = new UE.SlateColor();
    tone.SpecifiedColor = color;
    block.SetColorAndOpacity(tone);
    return place(canvas, block, x, y, 0, 0, z);
}

const INK = () => rgba(0.02, 0.018, 0.016), PAPER = () => rgba(0.93, 0.9, 0.84), FADED = () => rgba(0.93, 0.9, 0.84, 0.45);
const BLOOD = () => rgba(0.62, 0.03, 0.015), GOLD = () => rgba(0.78, 0.62, 0.36);

// The screen's own ink pictures (art/*.png next to this main.js, drawn by make_art.py): white with an alpha
// channel, coloured here. A picture that cannot be read is null, and the screen draws a plain shape instead.
const art = {};
function artTexture(name) {
    if (art[name] === null || valid(art[name]))
        return art[name];
    const path = UE.KismetSystemLibrary.ConvertToAbsolutePath(String(__dirname).replace(/[\\/]+$/, "") + "/art/" + name + ".png");
    art[name] = attempt("art " + name, () => UE.KismetRenderingLibrary.ImportFileAsTexture2D(player(), path)) || null;
    if (!said["art " + name])
        log(`art ${name}: ${art[name] ? "read" : "not read (" + path + ")"}`);
    said["art " + name] = true;
    return art[name];
}

// One of the ink pictures, stretched over a box and coloured. null when the picture is missing.
function ink(canvas, name, x, y, w, h, color, z) {
    const texture = artTexture(name);
    if (!texture)
        return null;
    const image = make(UE.Image);
    image.SetBrushFromTexture(texture, false);
    image.SetColorAndOpacity(color);
    return place(canvas, image, x, y, w, h, z);
}

// A line of text centred in a box of width w.
function labelIn(canvas, text, x, y, w, size, color, z) {
    const line = label(canvas, text, x, y, size, color, z);
    line.Slot.SetAutoSize(false);
    line.Slot.SetSize(vec(w, size * 1.7));
    line.SetJustification(UE.ETextJustify.Center);
    return line;
}

// Animations. The engine's own widget animations live in widget blueprints; the screen has none, so the mod
// moves its widgets itself, 30 times a second: apply(widget, t) is called with t from 0 (at once, and until
// `delay` ms have passed) to 1 (after `ms` more), eased out.
function animate(widget, delay, ms, apply) {
    apply(widget, 0);
    effects.push({ widget, at: Date.now() + delay, ms, apply });
}

function effectsTick() {
    if (effects.length == 0)
        return;
    const now = Date.now();
    effects = effects.filter((effect) => {
        if (now < effect.at)
            return true;
        const t = Math.min(1, (now - effect.at) / effect.ms);
        try {
            effect.apply(effect.widget, 1 - (1 - t) * (1 - t));
        }
        catch (e) {
            return false; // the widget is gone
        }
        return t < 1;
    });
}

const fadeIn = (widget, t) => widget.SetRenderOpacity(t);
const fadeOut = (widget, t) => widget.SetRenderOpacity(1 - t);
// Comes down onto the board from large to its own size, like a stamp or a sword stroke.
const slam = (widget, t) => {
    widget.SetRenderOpacity(Math.min(1, t * 2.5));
    widget.SetRenderScale(vec(2.8 - 1.8 * t, 2.8 - 1.8 * t));
};

// A canvas of 1920 x 1080 in the middle of a root canvas, over a shade of the given darkness (0: none).
function boardOn(root, darkness) {
    const board = make(UE.CanvasPanel);
    if (darkness) {
        const full = new UE.Anchors();
        full.Minimum = vec(0, 0);
        full.Maximum = vec(1, 1);
        const shade = make(UE.Image);
        shade.SetColorAndOpacity(rgba(0.03, 0.028, 0.025, darkness));
        const shadeSlot = root.AddChildToCanvas(shade);
        shadeSlot.SetAnchors(full);
        shadeSlot.SetOffsets(new UE.Margin(0, 0, 0, 0));
    }
    const centre = new UE.Anchors();
    centre.Minimum = vec(0.5, 0.5);
    centre.Maximum = vec(0.5, 0.5);
    const boardSlot = root.AddChildToCanvas(board);
    boardSlot.SetAnchors(centre);
    boardSlot.SetAlignment(vec(0.5, 0.5));
    boardSlot.SetPosition(vec(0, 0));
    boardSlot.SetSize(vec(1920, 1080));
    boardSlot.SetZOrder(1);
    return board;
}

// Puts a root canvas on the viewport and returns the user widget that holds it. The screen's widgets are made
// outside any user widget, and the engine puts such widgets on the viewport only through a user widget (game
// test: AddWidget of the bare canvas showed nothing). So the canvas becomes the root of one of the game's small
// user widgets.
function mount(root, layer) {
    const pc = UE.GameplayStatics.GetPlayerController(gameInstance, 0);
    const host = UE.WidgetBlueprintLibrary.Create(player(), UE.WidgetBlueprintGeneratedClass.Load(TIP_CLASS), pc);
    host.WidgetTree.RootWidget = root;
    host.AddToViewport(layer);
    host.SetRenderOpacity(1);
    host.SetColorAndOpacity(new UE.LinearColor(1, 1, 1, 1));
    host.SetVisibility(UE.ESlateVisibility.HitTestInvisible);
    if (!host.IsInViewport())
        throw new Error("the screen did not reach the viewport");
    return host;
}

// Strikes a square through with two brush strokes from corner to corner. drawAt >= 0: the strokes are drawn one
// after the other from their corners, the first after drawAt ms.
// The mod's own sounds (gauntlet/sound/*.wav, made by make_sounds.py). The game's sound runs on Wwise, which
// plays no file from outside its sound banks, so a sound goes through the engine's media player: it opens the
// file and a media sound component on the player gives it out. One player per voice: the same voice starts again
// when it is asked for a second time, two voices sound together.
const voices = {};
function voiceOf(key) {
    const owner = player();
    let at = voices[key];
    if (!at || !valid(at.media) || !valid(at.component)) {
        const media = UE.NewObject(UE.MediaPlayer.StaticClass(), owner);
        const component = owner.AddComponentByClass(UE.MediaSoundComponent.StaticClass(), false,
            UE.KismetMathLibrary.MakeTransform(new UE.Vector(0, 0, 0), new UE.Rotator(0, 0, 0), new UE.Vector(1, 1, 1)), false);
        component.bAllowSpatialization = false;
        component.bIsUISound = true;        // sounds while the game is paused, at full level everywhere
        component.SetMediaPlayer(media);    // the component holds the player: it lives as long as the component
        media.PlayOnOpen = false;           // the file is opened ahead of time and played when asked (game test: it does not start by itself)
        attempt("sound start", () => component.Start());
        at = voices[key] = { media, component, file: "", wanted: false };
    }
    return at;
}

// Opens a voice's file when it is not open yet. Opening takes the media player a moment: a sound that is asked
// for meanwhile (wanted) starts as soon as the file is ready.
function loadSound(name, voice) {
    const at = voiceOf(voice || name), file = filePath("sound/" + name + ".wav");
    if (at.file == file)
        return at;
    at.file = file;
    const opened = at.media.OpenFile(file);
    if (!said["sound " + name]) {
        said["sound " + name] = true;
        log(`sound ${name}: ${file} opened ${opened}`);
    }
    let tries = 0;
    const wait = () => attempt("sound wait", () => {
        if (!valid(at.media) || at.file != file)
            return;
        if (!at.media.IsReady())
            return ++tries < 40 ? setTimeout(wait, 50) : log(`sound ${name}: not ready after 2 s, error ${at.media.HasError()}`);
        if (at.wanted)
            startSound(name, at);
    });
    setTimeout(wait, 50);
    return at;
}

function startSound(name, at) {
    at.wanted = false;
    const media = at.media;
    media.Rewind();
    let playing = media.Play();
    if (!playing && !said["sound state " + name]) {
        // The player refuses to play: what it knows about the file, and one more try with the audio track chosen by hand.
        said["sound state " + name] = true;
        const audio = UE.EMediaPlayerTrack.Audio;
        log(`sound ${name} refused: audio tracks ${media.GetNumTracks(audio)}, chosen ${media.GetSelectedTrack(audio)}, `
            + `channels ${media.GetAudioTrackChannels(0, 0)}, rate ${media.GetAudioTrackSampleRate(0, 0)}, supports play ${media.SupportsRate(1, true)}/${media.SupportsRate(1, false)}, `
            + `paused ${media.IsPaused()}, preparing ${media.IsPreparing()}, closed ${media.IsClosed()}, url ${media.GetUrl()}`);
        const chosen = media.SelectTrack(audio, 0);
        playing = media.SetRate(1);
        log(`sound ${name}: track chosen ${chosen}, second try ${playing}`);
    }
    if (!said["sound play " + name]) {
        said["sound play " + name] = true;
        setTimeout(() => attempt("sound check", () => log(`sound ${name}: play ${playing}; after 0.2 s playing ${at.media.IsPlaying()}, `
            + `error ${at.media.HasError()}, component playing ${at.component.IsPlaying()}`)), 200);
    }
}

function playSound(name, voice) {
    if (!SETTINGS.SOUNDS)
        return;
    attempt("sound " + name, () => {
        const at = loadSound(name, voice);
        if (at.media.IsReady())
            startSound(name, at);
        else
            at.wanted = true;
    });
}

// Opens the board's sounds ahead of time, so that each starts the moment it is asked for.
function loadSounds() {
    if (!SETTINGS.SOUNDS)
        return;
    attempt("sounds", () => {
        for (const [name, voice] of [["board"], ["drum"], ["stamp"], ["reveal"], ["stroke", "stroke 0"], ["stroke", "stroke 1"]])
            loadSound(name, voice);
    });
}
const soundAt = (ms, name, voice) => setTimeout(() => playSound(name, voice), ms);

function strike(canvas, x, y, size, z, drawAt) {
    const length = size * 1.42, width = size * 0.24;
    const strokes = [[x, y, 45], [x + size, y, 135]].map(([fromX, fromY, angle]) => {
        // The stroke lies along its own x axis and turns about its left end, the corner it starts from.
        const stroke = ink(canvas, "stroke", fromX, fromY - width / 2, length, width, BLOOD(), z)
            || block(canvas, fromX, fromY - width / 4, length, width / 2, BLOOD(), z);
        stroke.SetRenderTransformPivot(vec(0, 0.5));
        stroke.SetRenderTransformAngle(angle);
        return stroke;
    });
    if (drawAt < 0)
        return;
    const DRAW_MS = 240, GAP_MS = 140;
    strokes.forEach((stroke, i) => {
        soundAt(drawAt + i * (DRAW_MS + GAP_MS), "stroke", "stroke " + i);
        // Drawn: the stroke grows along its length from the corner.
        animate(stroke, drawAt + i * (DRAW_MS + GAP_MS), DRAW_MS, (widget, t) => {
            widget.SetRenderOpacity(t > 0 ? 1 : 0);
            widget.SetRenderScale(vec(Math.max(0.001, t), 1 + 0.6 * (1 - t)));
        });
    });
}

// The bells a gauntlet still waits for, by name: the arena bells of its opponents that are not rung in this
// playthrough. An opponent whose bell the mod does not know asks for none.
function closedBells(gauntlet) {
    return attempt("bell check", () => {
        const bells = bellManager(), names = [];
        for (const id of gauntlet.fights) {
            const boss = BOSSES[id], arena = boss.arena && ARENAS.find((a) => a.id == boss.arena);
            const bell = arena ? arena.bell : boss.bell;
            if (!bell || bells.IsBellActivated(bell))
                continue;
            const name = arena ? arena.name
                : String(attempt("bell name", () => UE.KismetTextLibrary.Conv_TextToString(UE.EventPipelineManager.Conv_LocTextToText(bells.GetBellNameFromBellID(bell)))) || bell);
            if (!names.includes(name))
                names.push(name);
        }
        return names;
    }) || [];
}

// A gauntlet is sealed until the gauntlets it needs have each been won once and the arena bells of its
// opponents are rung: every opponent is then fought where it belongs.
const isSealed = (gauntlet, records) => (gauntlet.needs || []).some((id) => !hasWon(records, id)) || closedBells(gauntlet).length > 0;

const boardLine = (entry, place) => `${place}.    ${clock(entry.time)}    ·    Rank ${entry.rank}    ·    ${entry.perfect} perfect parries    ·    ${entry.hits} hits`
    + `${entry.vows && entry.vows.length ? `    ·    ${entry.vows.length} vows` : ""}    ·    ${entry.date}`;

// Builds the screen for the menu's state and returns its root widget. Laid out on 1920 x 1080, centred.
// The board has three uses:
// - before a run (no menu.run, no menu.result): the first opponent is known, the rest unknown, nothing struck;
// - between two fights (menu.run): the fallen are struck, the next opponent is revealed and marked;
// - after a run (menu.result): a win shows the rank on a stamp and the list of the best runs, a loss the
//   opponent the player fell to.
// The first time a board is drawn (menu.fresh) its news is animated: the cross comes down on the opponent that
// has just fallen, the next opponent appears out of its question marks, the rank is stamped.
function buildScreen() {
    const gauntlet = GAUNTLETS[menu.selected], count = gauntlet.fights.length;
    const current = menu.run, result = menu.result, ended = result ? result.ended : null, live = current || ended;
    const won = !!result && result.won;
    const sealed = !live && isSealed(gauntlet, menu.records);
    const fallenNow = current ? current.fight + 1 : !result ? 0 : won ? count : Math.max(0, ended.fight);
    const marked = won || sealed ? -1 : fallenNow;      // the opponent the board is about
    const best = (menu.records[gauntlet.id] || [])[0];
    const arena = !live ? menu.arenas[menu.arena]
        : current && current.own && ownArena(gauntlet.fights[fallenNow]) || live.arena;
    // With each opponent in its own arena: where the first one is fought, when the mod knows its arena.
    const firstArena = !live && !sealed && arena && arena.own ? ownArena(gauntlet.fights[0]) : null;
    const passed = !live && hasWon(menu.records, gauntlet.id);                    // won before: its opponents are no secret any more
    const stateOf = (i) => sealed ? "unknown" : i < fallenNow ? "beaten" : i == fallenNow || passed ? "known" : "unknown";
    const fresh = menu.fresh;
    const fx = (widget, delay, ms, apply) => { if (fresh && widget) animate(widget, delay, ms, apply); return widget; };
    const red = () => rgba(0.85, 0.12, 0.06);

    const root = make(UE.CanvasPanel), board = boardOn(root, 0.82);

    // The head.
    const caption = current ? `FIGHT ${fallenNow + 1} OF ${count}`
        : passed ? `GAUNTLET PASSED   ·   ${count} ${count == 1 ? "OPPONENT" : "OPPONENTS"}`
        : !result ? `GAUNTLET OF STRENGTH   ·   ${count} ${count == 1 ? "OPPONENT" : "OPPONENTS"}`
        : won ? "GAUNTLET CONQUERED" : `FALLEN IN FIGHT ${fallenNow + 1} OF ${count}`;
    label(board, caption, 190, 78, 20, passed || result && !won ? red() : GOLD(), 2);
    label(board, gauntlet.name, 188, 104, 54, PAPER(), 2);
    ink(board, "line", 180, 186, 760, 16, GOLD(), 2) || block(board, 188, 192, 740, 2, GOLD(), 2);
    if (live)
        label(board, `${clock(runTime(live))}   ·   ${live.perfect} perfect parries   ·   ${hitsOf(live)} hits`, 190, 214, 20, FADED(), 2);
    else
        label(board, `‹   ${menu.selected + 1} / ${GAUNTLETS.length}   ›   ·   ${GAUNTLETS.filter((g) => hasWon(menu.records, g.id)).length} passed`, 190, 214, 20, FADED(), 2);
    if (!live && !sealed) {
        // The vows, to choose: taken ones in red, the one under the cursor bright, with what it means below.
        label(board, "Vows", 190, 242, 16, GOLD(), 2);
        VOWS.forEach((vow, i) => {
            const taken = chosenVows.includes(vow.id), at = menu.vow == i;
            label(board, `${taken ? "■" : "□"} ${vow.name}`, 290 + i * 162, 242, 16, at ? PAPER() : taken ? red() : FADED(), 2);
        });
        if (menu.vow >= 0)
            label(board, VOWS[menu.vow].text, 290, 264, 13, FADED(), 2);
    }
    else if (live && live.vows.length)
        label(board, "Vows:   " + vowNames(live.vows).join("   ·   "), 190, 246, 16, red(), 2);
    if (!live && best) {
        // The best rank won so far, as a small stamp beside the name.
        const stamp = ink(board, "seal", 868, 92, 84, 84, rgba(0.72, 0.05, 0.02), 2);
        if (stamp) {
            stamp.SetRenderTransformAngle(-6);
            labelIn(board, best.rank, 868, 100, 84, 36, PAPER(), 3).SetRenderTransformAngle(-6);
        }
    }

    // The ladder: a portrait in a brush frame and the name on a brush stroke for each opponent. A long gauntlet
    // shows the rows around the next opponent.
    const rows = Math.min(count, LADDER_ROWS), first = Math.max(0, Math.min(fallenNow - 2, count - rows));
    const top = live ? 290 : 304, step = Math.min(128, Math.floor((live ? 650 : 636) / rows)), side = Math.min(100, step - 24), left = 205;
    if (first > 0)
        label(board, `▲   ${first} beaten`, left + side + 70, top - 34, 17, FADED(), 2);
    if (first + rows < count)
        label(board, `+   ${count - first - rows} more`, left + side + 70, top + rows * step - 12, 17, FADED(), 2);
    for (let i = first; i < first + rows; i++) {
        const y = top + (i - first) * step, state = stateOf(i), chosen = i == marked, face = faceOf(gauntlet.fights[i]);
        const justFell = (current || won) && i == fallenNow - 1;    // the board opens because this one fell
        const revealed = fresh && !!current && i == fallenNow;      // and this one shows itself now
        if (i + 1 < first + rows)
            block(board, left + side / 2 - 1, y + side + 6, 3, step - side - 12, rgba(0.93, 0.9, 0.84, 0.3), 1);
        block(board, left, y, side, side, rgba(0, 0, 0, 0.75), 1);
        if (state != "unknown" && face.icon) {
            const icon = picture(board, face.icon, left + 8, y + 8, side - 16, side - 16, 3, state == "beaten" ? rgba(1, 1, 1, 0.3) : rgba(1, 1, 1, 1));
            if (revealed) {
                fx(icon, 900, 500, fadeIn);
                fx(label(board, "？", left + side / 2 - 22, y + side / 2 - 30, 40, FADED(), 3), 900, 400, fadeOut);
            }
        }
        else
            label(board, "？", left + side / 2 - 22, y + side / 2 - 30, 40, FADED(), 3);
        ink(board, "frame", left - 7, y - 7, side + 14, side + 14, chosen ? PAPER() : rgba(0.93, 0.9, 0.84, 0.35), 4);
        if (state == "beaten")
            strike(board, left - 10, y - 10, side + 20, 5, fresh && justFell ? 800 : -1);
        // The name: bone white for the marked opponent, ink black otherwise, dark red once fallen.
        const barX = left + side + 26, barY = y + (side - 72) / 2, barW = 650;
        const tone = chosen ? PAPER() : state == "beaten" ? rgba(0.3, 0.02, 0.012, 0.85) : rgba(0, 0, 0, state == "known" ? 0.9 : 0.55);
        const bar = ink(board, "stroke", barX, barY, barW, 72, tone, 2) || block(board, barX + 12, barY + 8, barW - 40, 56, tone, 2);
        if (fresh && justFell) {
            // Until the strike has landed the bar is still the black of a living opponent.
            fx(bar, 1400, 400, fadeIn);
            fx(ink(board, "stroke", barX, barY, barW, 72, rgba(0, 0, 0, 0.9), 2), 1400, 400, fadeOut);
        }
        const name = label(board, state == "unknown" ? "？ ？ ？" : face.name, barX + 44, barY + 15, 27,
            chosen ? INK() : state == "known" ? PAPER() : FADED(), 3);
        if (revealed) {
            fx(name, 900, 500, fadeIn);
            fx(label(board, "？ ？ ？", barX + 44, barY + 15, 27, INK(), 3), 900, 400, fadeOut);
        }
    }

    // The right side: the rank of a won run, else the marked opponent's codex picture.
    ink(board, "wash", 1010, 60, 760, 640, rgba(0, 0, 0, 0.8), 1) || block(board, 1040, 80, 700, 600, rgba(0, 0, 0, 0.7), 1);
    ink(board, "stroke", 1020, 660, 760, 92, rgba(0, 0, 0, 0.95), 4) || block(board, 1040, 672, 700, 68, INK(), 4);
    ink(board, "line", 1070, 800, 660, 10, rgba(0.93, 0.9, 0.84, 0.3), 2);
    if (won) {
        const entry = result.entry;
        const stamp = ink(board, "seal", 1230, 110, 320, 320, rgba(0.72, 0.05, 0.02), 3) || block(board, 1250, 130, 280, 280, rgba(0.72, 0.05, 0.02), 3);
        stamp.SetRenderTransformAngle(-5);
        const letter = labelIn(board, entry.rank, 1230, 160, 320, 130, PAPER(), 4);
        letter.SetRenderTransformAngle(-5);
        fx(stamp, 900, 220, slam);
        fx(letter, 900, 220, slam);
        if (fresh)
            soundAt(900 + 200, "stamp");    // as the stamp lands
        fx(labelIn(board, "TIME", 1230, 462, 320, 18, GOLD(), 3), 1300, 500, fadeIn);
        fx(labelIn(board, clock(entry.time), 1230, 488, 320, 62, PAPER(), 3), 1300, 500, fadeIn);
        label(board, "Conquered", 1076, 682, 32, PAPER(), 5);
        label(board, result.place == 1 ? "New best time!" : result.place ? `Place ${result.place} among the best runs` : "Not among the best ten", 1078, 764, 21, GOLD(), 3);
        label(board, `${entry.perfect} perfect parries   ·   ${entry.deflects} parries   ·   ${entry.hits} hits` + (entry.rests ? `   ·   ${entry.rests} × rested` : ""),
            1078, 820, 22, PAPER(), 3);
        label(board, "Best runs", 1078, 866, 17, GOLD(), 3);
        result.list.slice(0, 3).forEach((line, i) => label(board, boardLine(line, i + 1), 1078, 890 + i * 24, 16, line === entry ? GOLD() : FADED(), 3));
    }
    else {
        const state = marked < 0 ? "unknown" : stateOf(marked), face = marked < 0 ? null : faceOf(gauntlet.fights[marked]);
        const revealed = fresh && !!current;
        if (state != "unknown" && face.art) {
            const art = picture(board, face.art, 1060, 90, 660, 580, 3, null);
            if (revealed)
                fx(art, 900, 600, fadeIn);
        }
        else
            label(board, "？", 1340, 290, 110, FADED(), 3);
        const name = label(board, sealed ? "Sealed" : face.name, 1076, 682, 32, PAPER(), 5);
        if (revealed) {
            fx(name, 900, 600, fadeIn);
            soundAt(1700, "reveal");        // after the two strokes of the cross
        }
        // A sealed gauntlet names the gauntlets that are still to be won.
        const open = (gauntlet.needs || []).filter((id) => !hasWon(menu.records, id)).map((id) => GAUNTLETS.find((g) => g.id == id).name);
        const bellsOpen = sealed && !open.length ? closedBells(gauntlet) : [];
        if (bellsOpen.length)   // the first three by name, the rest as a number
            open.push(...bellsOpen.slice(0, 3), ...(bellsOpen.length > 3 ? [`and ${bellsOpen.length - 3} more`] : []));
        const status = sealed ? (bellsOpen.length ? "Ring first: " : "Conquer first: ") + open.join("  ·  ") : result ? (ended.broken ? `Vow broken: ${ended.broken}` : "You fell here") : current ? "Next challenger" : "The first opponent";
        label(board, status, 1078, 764, sealed && open.length > 1 ? 17 : 21, sealed ? FADED() : result ? red() : GOLD(), 3);

        label(board, "Place", 1078, 820, 17, GOLD(), 3);
        label(board, live ? (arena ? arena.name : "Right here") : `‹  ${arena ? arena.name : "Here, where you stand"}  ›`, 1078, 842, 25, PAPER(), 3);
        if (current) {
            const character = player();
            const health = Math.round(100 * attribute(character, "Health") / Math.max(1, attribute(character, "Health_Max")));
            label(board, "Your state", 1078, 890, 17, GOLD(), 3);
            label(board, `Health ${health} %` + (current.rests ? `   ·   ${current.rests} × rested` : ""), 1078, 912, 23, health <= 35 ? red() : PAPER(), 3);
        }
        else if (!result) {
            if (arena && arena.own)
                label(board, firstArena ? `First fight: ${firstArena.name}` : "First fight: here (this opponent's arena is not known yet)", 1078, 874, 15, FADED(), 3);
            label(board, "Best run", 1078, 898, 17, GOLD(), 3);
            label(board, best ? `${clock(best.time)}   ·   Rank ${best.rank}   ·   ${best.perfect} perfect parries   ·   ${best.hits} hits` : "Not conquered yet",
                1078, 920, 23, best ? PAPER() : FADED(), 3);
        }
    }

    const keys = result ? "Enter / A  Continue"
        : sealed ? "◄ ►  Gauntlet        Backspace / B  Close"
        : menu.wiping ? `Del / X  really delete the best runs of “${gauntlet.name}”        any other key: keep them`
        : !current ? `◄ ►  Gauntlet        Up / Down  Vows        Del / X  ${menu.vow >= 0 ? "take the vow" : best ? "delete best runs" : "—"}        Tab / Y  Place        Enter / A  Begin        Backspace / B  Close`
        : menu.quitting ? "Del / X  really give up the run        any other key: fight on"
        : `Enter / A  Next challenger        ${current.vows.includes("noRest") ? "(vow: no rest)" : menu.rested ? "(rested)" : "R / Y  Rest"}        Backspace / B  Close        Del / X  Give up`;
    ink(board, "line", 180, 968, 1560, 10, rgba(0.93, 0.9, 0.84, 0.3), 2);
    label(board, keys, 190, 990, 19, menu.quitting || menu.wiping ? red() : FADED(), 2);
    return root;
}

// Shows the screen for the menu's state, in place of the one before.
function drawScreen() {
    const host = mount(buildScreen(), 200);
    menu.fresh = false;
    if (!said.screen)
        log("screen on the viewport");
    said.screen = true;
    const old = menu.screen;
    menu.screen = host;
    if (old)
        attempt("old screen removal", () => old.RemoveFromParent());
}

// The name card: when an opponent arrives, its name on a brush stroke in the upper part of the screen, for a
// few seconds.
function showCard(caption, name, ms) {
    hideCard();
    const root = make(UE.CanvasPanel), board = boardOn(root, 0);
    ink(board, "stroke", 410, 196, 1100, 132, rgba(0, 0, 0, 0.92), 1) || block(board, 460, 210, 1000, 104, rgba(0, 0, 0, 0.85), 1);
    labelIn(board, caption, 410, 168, 1100, 19, GOLD(), 2);
    labelIn(board, name, 410, 226, 1100, 42, PAPER(), 2);
    ink(board, "line", 660, 318, 600, 12, GOLD(), 2);
    const host = mount(root, 150);
    const mine = { host, timer: null };
    playSound("drum");
    animate(host, 0, 350, fadeIn);
    animate(host, (ms || 3300) - 500, 500, fadeOut);
    mine.timer = setTimeout(() => { if (card === mine) hideCard(); }, (ms || 3300) + 100);
    card = mine;
}

function hideCard() {
    if (!card)
        return;
    clearTimeout(card.timer);
    const host = card.host;
    card = null;
    attempt("card removal", () => { if (valid(host)) host.RemoveFromParent(); });
}

// The menu's keys: each action is true in the tick in which one of its keys goes down.
const MENU_KEYS = {
    up: ["Up", "W", "Gamepad_DPad_Up"], down: ["Down", "S", "Gamepad_DPad_Down"],
    left: ["Left", "A", "Gamepad_DPad_Left"], right: ["Right", "D", "Gamepad_DPad_Right"],
    arena: ["Tab", "R", "Gamepad_FaceButton_Top"],
    confirm: ["Enter", "SpaceBar", "Gamepad_FaceButton_Bottom"], back: ["BackSpace", "G", "Gamepad_FaceButton_Right"],
    quit: ["Delete", "Gamepad_FaceButton_Left"],
};
const menuKeys = {};
for (const action of Object.keys(MENU_KEYS))
    menuKeys[action] = MENU_KEYS[action].map(key);

const WHITE = () => new UE.LinearColor(1, 1, 1, 1), DIM = () => new UE.LinearColor(1, 1, 1, 0.4), RED = () => new UE.LinearColor(1, 0.22, 0.12, 1);

// One line of the menu: the game's tip strip at a column and a row. Its text and colour change, the widget stays.
function menuLine(x, row) {
    const M = SETTINGS.MENU;
    const pc = UE.GameplayStatics.GetPlayerController(gameInstance, 0);
    const widget = UE.WidgetBlueprintLibrary.Create(player(), UE.WidgetBlueprintGeneratedClass.Load(TIP_CLASS), pc);
    widget.AddToViewport(60);
    widget.SetRenderTranslation(new UE.Vector2D(x, M.Y + row * M.STEP));
    widget.SetRenderScale(new UE.Vector2D(M.SCALE, M.SCALE));
    attempt("menu fade in", () => widget.PlayAnimation(widget.FadeIn, 0, 1, 0, 3, false));
    return widget;
}

function setLine(widget, text, color) {
    widget.SetText(toText(text));
    widget.SetColorAndOpacity(color);
    widget.SetVisibility(text ? UE.ESlateVisibility.HitTestInvisible : UE.ESlateVisibility.Collapsed);
}

// Lets the game's own input through to the player, or holds it back while the menu is open.
function holdInput(hold) {
    attempt("input " + (hold ? "hold" : "release"), () => {
        const pc = UE.GameplayStatics.GetPlayerController(gameInstance, 0), character = player();
        if (hold) {
            character.DisableInput(pc);
            pc.DisableInput(pc);
        }
        else {
            pc.EnableInput(pc);
            character.EnableInput(pc);
        }
    });
}

// Writes what the game knows of places to the log: once the rung bells with name and place, and once for each
// map its music volumes with the enemies they name. From these the arenas of the bosses are worked out.
function logPlaces() {
    const map = String(UE.KismetSystemLibrary.GetPathName(player())).split(".")[0];
    if (!said.bells) attempt("bell list", () => {
        const bells = bellManager(), ids = bells.GetAllActivateBellIDs();
        for (let i = 0; i < ids.Num(); i++) {
            const id = ids.Get(i), at = bells.GetBellLocationFromBellID(id);
            const name = attempt("bell name", () => UE.KismetTextLibrary.Conv_TextToString(UE.EventPipelineManager.Conv_LocTextToText(bells.GetBellNameFromBellID(id))));
            said.bells = true;
            log(`place bell: ${id} | ${bells.GetLevelNameFromBellID(id)} | ${name} | ${Math.round(at.X)} ${Math.round(at.Y)} ${Math.round(at.Z)}`);
        }
    });
    if (!said.allBells) attempt("bell list of the levels", () => {
        const bells = bellManager();
        // The levels the mod knows, and the levels of the rung bells: the game names the level of each bell.
        const levels = Object.assign({}, LEVEL_MAPS, musicZones()._maps || {}), rung = bells.GetAllActivateBellIDs();
        for (let i = 0; i < rung.Num(); i++)
            levels[String(bells.GetLevelNameFromBellID(rung.Get(i)))] = true;
        for (const level of Object.keys(levels)) {
            const entries = bells.GetBellsWithLevel(false, level);
            for (let i = 0; i < entries.Num(); i++) {
                const entry = entries.Get(i), at = entry.BellTransform.GetLocation ? entry.BellTransform.GetLocation() : entry.BellTransform.Translation;
                said.allBells = true;
                log(`place bell of ${level}: ${entry.BellID} | ${UE.KismetTextLibrary.Conv_TextToString(entry.BellName)} | ${Math.round(at.X)} ${Math.round(at.Y)} ${Math.round(at.Z)} | ${bells.IsBellActivated(entry.BellID) ? "rung" : "not rung"}`);
            }
        }
    });
    // Only the music volumes near the player are loaded, so each opening of the board may see new ones.
    attempt("music volume list", () => {
        const found = puerts.$ref(UE.NewArray(UE.Actor));
        UE.GameplayStatics.GetAllActorsOfClass(player(), UE.PBZMusicVolume.StaticClass(), found);
        const volumes = puerts.$unref(found), all = musicZones();
        const level = map.split("/").pop();
        let changed = false;
        all._maps = all._maps || {};
        if (map.startsWith("/Game/") && all._maps[level] != map) {
            all._maps[level] = map;
            changed = true;
        }
        for (let i = 0; i < volumes.Num(); i++) {
            const volume = volumes.Get(i), names = [];
            for (let n = 0; n < volume.SpecificEnemyNames.Num(); n++)
                names.push(String(volume.SpecificEnemyNames.Get(n)));
            if (names.length == 0)
                continue;
            const at = volume.K2_GetActorLocation(), origin = puerts.$ref(new UE.Vector(0, 0, 0)), extent = puerts.$ref(new UE.Vector(0, 0, 0));
            volume.GetActorBounds(false, origin, extent, false);
            const middle = puerts.$unref(origin), half = puerts.$unref(extent);
            const key = map + " " + names.join(",");
            if (said[key])
                continue;
            said[key] = true;
            // With the place the mod keeps the music itself (the paths of its sound event and of the fight's
            // state), so it can play a boss's music in any arena.
            const event = pathOf(volume.SoundEvent);
            names.forEach((name, n) => {
                const state = n < volume.SpecificMusicState_InCombat.Num() ? pathOf(volume.SpecificMusicState_InCombat.Get(n)) : "";
                const zone = { map, x: Math.round(middle.X), y: Math.round(middle.Y), z: Math.round(middle.Z) };
                if (event && state)
                    Object.assign(zone, { event, state });
                if (JSON.stringify(all[name.toLowerCase()]) != JSON.stringify(zone))
                    changed = true;
                all[name.toLowerCase()] = zone;
            });
            log(`place music: ${map} | [${names.join(", ")}] | actor ${Math.round(at.X)} ${Math.round(at.Y)} ${Math.round(at.Z)}`
                + ` | middle ${Math.round(middle.X)} ${Math.round(middle.Y)} ${Math.round(middle.Z)} | half ${Math.round(half.X)} ${Math.round(half.Y)} ${Math.round(half.Z)}`);
        }
        if (changed)
            attempt("zones write", () => UE.EasyCsv.SaveStringToFileWithFullPath(JSON.stringify(all), filePath(ZONES_FILE)));
    });
    // The game's own spawners of the bosses: each stands where its boss stands in the game, in the boss's arena.
    // A spawner belongs to a boss by its class or by its name (game test: "LuanShi_Seq030", "HuaQianXiao_Seq027").
    // Several may match (stages for cutscenes far above the map, ordinary enemies of the same class elsewhere):
    // the one nearest to the boss's bell is kept, with d, its distance from that bell.
    attempt("spawner list", () => {
        const found = puerts.$ref(UE.NewArray(UE.Actor));
        UE.GameplayStatics.GetAllActorsOfClass(player(), UE.AISpawner.StaticClass(), found);
        const spawners = puerts.$unref(found), all = musicZones(), bells = bellManager();
        const bosses = Object.keys(BOSSES).filter((id) => BOSSES[id].cls).map((id) => {
            const boss = BOSSES[id], arena = boss.arena && ARENAS.find((a) => a.id == boss.arena), bell = arena ? arena.bell : boss.bell;
            const cls = boss.cls.split(".").pop().toLowerCase();
            return { id, bell, cls, short: cls.replace(/^bp_monster_/, "").split("_")[0] };
        }).filter((boss) => boss.bell && mapOfLevel(String(bells.GetLevelNameFromBellID(boss.bell))) == map);
        let changed = false;
        all._spawns = all._spawns || {};
        for (let i = 0; i < spawners.Num(); i++) {
            const spawner = spawners.Get(i), path = spawnerClass(spawner).toLowerCase(), name = String(spawner.SpawnerID || "");
            const boss = bosses.find((b) => path.endsWith("." + b.cls) || name.toLowerCase().includes(b.short));
            if (!boss)
                continue;
            const at = spawner.K2_GetActorLocation(), bellAt = bells.GetBellLocationFromBellID(boss.bell);
            const spot = { map, x: Math.round(at.X), y: Math.round(at.Y), z: Math.round(at.Z), yaw: Math.round(spawner.K2_GetActorRotation().Yaw),
                alive: valid(spawner.SpawnedAI) && !isDead(spawner.SpawnedAI), spawner: name,
                d: Math.round(Math.hypot(at.X - bellAt.X, at.Y - bellAt.Y, at.Z - bellAt.Z)) };
            const known = all._spawns[boss.id];
            if (!said["spawner " + boss.id + name + spot.x]) {
                said["spawner " + boss.id + name + spot.x] = true;
                log(`place spawner: ${boss.id} | ${map} | ${spot.x} ${spot.y} ${spot.z} yaw ${spot.yaw} | ${spot.alive ? "its boss stands there" : "empty"} | ${name} | ${Math.round(spot.d / 100)} m from its bell`);
            }
            if (known && known.d !== undefined && (known.d < spot.d || JSON.stringify(known) == JSON.stringify(spot)))
                continue;   // the known one is nearer to the bell, or nothing is new
            all._spawns[boss.id] = spot;
            changed = true;
        }
        for (const id of Object.keys(all._spawns))
            if (all._spawns[id].d === undefined) {  // noted by an earlier version, without a bell to measure from
                delete all._spawns[id];
                changed = true;
            }
        if (!said["spawners of " + map]) {
            said["spawners of " + map] = true;
            log(`spawners: ${spawners.Num()} loaded here`);
        }
        if (changed)
            attempt("zones write", () => UE.EasyCsv.SaveStringToFileWithFullPath(JSON.stringify(all), filePath(ZONES_FILE)));
    });
}

// The path of the class a spawner spawns, "" when it cannot be read.
function spawnerClass(spawner) {
    try {
        const path = String(UE.KismetSystemLibrary.Conv_SoftClassReferenceToString(spawner.Class) || "");
        if (path)
            return path;
    }
    catch (e) { }
    try {
        return valid(spawner.SpawnedAI) ? String(UE.KismetSystemLibrary.GetPathName(spawner.SpawnedAI.GetClass())) : "";
    }
    catch (e) {
        return "";
    }
}

// Opens the board: to choose a gauntlet, as the stop between two fights of the run in progress (forRun), or to
// show how a run ended (result, see showResult; throws when the board cannot be built).
function openMenu(forRun, result) {
    hideLadder();
    hideCard();
    logPlaces();
    loadSounds();
    const M = SETTINGS.MENU;
    const longest = Math.min(LADDER_ROWS, Math.max(...GAUNTLETS.map((g) => g.fights.length)));
    const shown = forRun || (result && result.ended);
    menu = {
        run: forRun || null,                    // the run whose stop between two fights this is, or null
        result: result || null,                 // the ended run this board is about, or null
        fresh: true,                            // not drawn yet: the first drawing is animated
        vow: -1,                                // the vow under the cursor on the board, -1: none
        wiping: false,                          // asked once to delete the chosen gauntlet's best runs
        rested: false, quitting: false,         // at a stop: rested here already; asked once to give up
        openedAt: Date.now(),
        selected: shown ? GAUNTLETS.indexOf(shown.gauntlet) : 0, arena: 0,
        row: forRun ? forRun.fight + 1 : 0,     // the ladder's chosen opponent: at a stop the next one
        screen: null,                           // the board on the viewport; null: the fallback of tip strips
        arenas: [OWN_ARENAS].concat(openArenas(), [null]),  // null: the place the player stands
        records: loadRecords(),
        down: {},                               // action -> its keys were down at the last tick
        who: UE.KismetSystemLibrary.GetPathName(player()),
        left: [], ladder: [], info: [],
    };
    for (const action of Object.keys(menuKeys))
        menu.down[action] = true;               // not seen up yet: the press that opened the menu does nothing in it
    try {
        drawScreen();
    }
    catch (e) {
        log("the screen could not be built, using the tip strips: " + e);
        if (menu.screen)
            attempt("screen removal", () => menu.screen.RemoveFromParent());
        menu.screen = null;
    }
    if (!menu.screen && result) {
        menu = null;
        throw new Error("no board for the result");
    }
    if (!menu.screen) attempt("menu build", () => {
        menu.title = menuLine(M.LEFT_X, 0);
        GAUNTLETS.forEach((g, i) => menu.left.push(menuLine(M.LEFT_X, i + 1.4)));
        menu.hint = menuLine(M.LEFT_X, GAUNTLETS.length + 2.2);
        menu.heading = menuLine(M.RIGHT_X, 0);
        for (let i = 0; i < longest; i++)
            menu.ladder.push(menuLine(M.RIGHT_X, i + 1.4));
        for (let i = 0; i < 3; i++)
            menu.info.push(menuLine(M.RIGHT_X, longest + 2.2 + i));
    });
    holdInput(true);
    playSound("board");
    if (!menu.screen)
        drawMenu(); // the board is drawn already; a second drawing would end its animations at once (game test)
    log("menu opened");
}

function drawMenu() {
    if (menu.screen) {
        attempt("screen draw", drawScreen);
        return;
    }
    attempt("menu draw", () => {
        const gauntlet = GAUNTLETS[menu.selected];
        const beaten = menu.run ? menu.run.fight + 1 : 0;
        const best = (menu.records[gauntlet.id] || [])[0];
        const arena = menu.arenas[menu.arena];
        setLine(menu.title, "GAUNTLETS", WHITE());
        menu.left.forEach((widget, i) => setLine(widget, (i == menu.selected ? "»  " : "") + GAUNTLETS[i].name, i == menu.selected ? WHITE() : DIM()));
        setLine(menu.hint, "Enter / A: Start      Backspace / B: Close", DIM());
        setLine(menu.heading, `${gauntlet.name} — ${gauntlet.fights.length} opponents`, WHITE());
        menu.ladder.forEach((widget, i) => {
            if (i >= gauntlet.fights.length)
                setLine(widget, "", DIM());
            else if (i < beaten)
                setLine(widget, "斩   " + BOSSES[gauntlet.fights[i]].name, RED());
            else
                setLine(widget, "？ ？ ？", i == beaten ? WHITE() : DIM());
        });
        setLine(menu.info[0], `‹  Arena: ${arena ? arena.name : "Here, where you stand"}  ›`, WHITE());
        setLine(menu.info[1], best ? `Best time ${clock(best.time)}   ·   Rank ${best.rank}` : "Not conquered yet", best ? WHITE() : DIM());
        setLine(menu.info[2], best ? `${best.perfect} perfect parries   ·   ${best.hits} hits` : "No healing. One life.", DIM());
    });
}

function closeMenu() {
    if (!menu)
        return;
    const closed = menu;
    menu = null;
    if (closed.screen)
        attempt("screen removal", () => closed.screen.RemoveFromParent());
    for (const widget of [closed.title, closed.hint, closed.heading].concat(closed.left, closed.ladder, closed.info))
        attempt("menu removal", () => { if (valid(widget)) widget.RemoveFromParent(); });
    holdInput(false);
    log("menu closed");
}

function menuTick(pc) {
    if (!player() || UE.KismetSystemLibrary.GetPathName(player()) != menu.who) {
        closeMenu();
        return;
    }
    const pressed = {};
    for (const action of Object.keys(menuKeys)) {
        const down = menuKeys[action].some((k) => pc.IsInputKeyDown(k));
        pressed[action] = down && !menu.down[action];
        menu.down[action] = down;
    }
    const step = (value, by, count) => (value + by + count) % count;
    if (menu.run) {
        stopTick(pressed);
        return;
    }
    if (menu.result) {
        if (pressed.confirm || pressed.back) {
            const result = menu.result;
            closeMenu();
            wasDown = true;
            conclude(result.ended, null, true);
        }
        return;
    }
    // The best runs of the chosen gauntlet are deleted with the quit key, asked twice; the gauntlet stays won.
    if (menu.wiping) {
        if (!Object.keys(pressed).some((action) => pressed[action]))
            return;
        if (pressed.quit) attempt("records wipe", () => {
            const id = GAUNTLETS[menu.selected].id, records = loadRecords();
            records[WON][id] = true;
            records[id] = [];
            saveRecords(records);
            menu.records = records;
            log(`best runs of ${id} deleted`);
        });
        menu.wiping = false;
        drawMenu();
        return;
    }
    if (pressed.quit && menu.screen && menu.vow < 0 && (menu.records[GAUNTLETS[menu.selected].id] || []).length) {
        menu.wiping = true;
        drawMenu();
        return;
    }
    if (pressed.back) {
        closeMenu();
        wasDown = true; // G closed the menu: the same press must not open it again
        return;
    }
    if (pressed.confirm && !isSealed(GAUNTLETS[menu.selected], menu.records)) {
        const gauntlet = GAUNTLETS[menu.selected], arena = menu.arenas[menu.arena];
        closeMenu();
        attempt("start", () => start(gauntlet, arena));
        return;
    }
    const before = `${menu.selected}/${menu.arena}/${menu.row}/${menu.vow}/${chosenVows}`;
    if (menu.screen) {
        // Up and down walk through the vows (and off them again), the quit key takes or drops the one marked.
        if (pressed.up || pressed.down)
            menu.vow = step(menu.vow + 1, pressed.up ? -1 : 1, VOWS.length + 1) - 1;
        if (pressed.quit && menu.vow >= 0) {
            const id = VOWS[menu.vow].id;
            chosenVows = chosenVows.includes(id) ? chosenVows.filter((other) => other != id) : chosenVows.concat([id]);
        }
        if (pressed.left || pressed.right) {
            menu.selected = step(menu.selected, pressed.left ? -1 : 1, GAUNTLETS.length);
            menu.row = 0;
        }
        if (pressed.arena)
            menu.arena = step(menu.arena, 1, menu.arenas.length);
    }
    else {
        if (pressed.up)
            menu.selected = step(menu.selected, -1, GAUNTLETS.length);
        if (pressed.down)
            menu.selected = step(menu.selected, 1, GAUNTLETS.length);
        if (pressed.left)
            menu.arena = step(menu.arena, -1, menu.arenas.length);
        if (pressed.right || pressed.arena)
            menu.arena = step(menu.arena, 1, menu.arenas.length);
    }
    if (before != `${menu.selected}/${menu.arena}/${menu.row}/${menu.vow}/${chosenVows}`)
        drawMenu();
}

// Takes the run in progress to another arena, between two fights. The journey loads the map and with it a new
// player object: the run's hold on the player (health floor, hit listener, the share of health left) is taken
// off before and put on again after.
function moveRun(moving, arena, bossId) {
    const character = player();
    removeProps(moving);
    const share = attribute(character, "Health") / Math.max(1, attribute(character, "Health_Max"));
    const leftAt = Date.now();
    setAttribute(character, "Health_Min", moving.floorBefore); // the journey saves the game: not with our floor
    // The journey ends this world: the listeners on its player and its bosses end with it.
    moving.listeners.forEach(unlisten);
    moving.listeners = [];
    moving.spawned = [];
    moving.state = "travel";
    const settle = (place) => {
        if (run !== moving)
            return;
        const now = player();
        moving.moved = true;
        moving.arena = place;
        moving.who = UE.KismetSystemLibrary.GetPathName(now);
        moving.floorBefore = attribute(now, "Health_Min");
        setAttribute(now, "Health_Min", HEALTH_FLOOR);
        setAttribute(now, "Health", Math.max(HEALTH_FLOOR + 1, share * attribute(now, "Health_Max")));
        moving.lastHealth = attribute(now, "Health");
        moving.listeners.push(listen(now, HIT_EVENT, () => { moving.hitEvents++; }));
        moving.idleMs += Date.now() - leftAt;
        moving.state = "pause";
        moving.nextAt = Date.now() + 3500;   // the new map settles first (the game crashed once right after an arrival)
        log(`run moved to ${place ? place.name : "where the game put the player"}, health ${moving.lastHealth}`);
    };
    toast(`${arena.name} …`, 3);
    try {
        // A journey that fails leaves the player somewhere: the run goes on there.
        travelInto(bossId || moving.gauntlet.fights[moving.fight + 1], arena, settle, () => settle(null));
    }
    catch (e) {
        log("the journey could not begin, the fight comes to this place: " + e);
        settle(moving.arena);
    }
}

// The board between two fights of a run: call the next opponent, rest, close it for now, or give up (asked twice).
function stopTick(pressed) {
    const current = menu.run;
    const any = Object.keys(pressed).some((action) => pressed[action]);
    if (pressed.quit && menu.quitting) {
        closeMenu();
        conclude(finish(), "Run given up.");
        return;
    }
    if (pressed.quit) {
        menu.quitting = true;
        drawMenu();
        return;
    }
    if (pressed.back && !menu.quitting) {
        closeMenu();    // the run waits: the board comes again from a bell or with the key
        wasDown = true;
        return;
    }
    if (menu.quitting && any) {
        menu.quitting = false; // the key only takes the question back
        drawMenu();
        return;
    }
    if (pressed.arena && !menu.rested && !current.vows.includes("noRest")) {
        attempt("rest", () => {
            const character = player();
            setAttribute(character, "Health", attribute(character, "Health_Max"));
            current.lastHealth = attribute(character, "Health");
            current.rests++;
            menu.rested = true;
            log("rested between fights");
        });
        drawMenu();
        return;
    }
    if (pressed.confirm) {
        current.idleMs += Date.now() - current.stopAt;
        closeMenu();
        const own = current.own ? ownArena(current.gauntlet.fights[current.fight + 1]) : null;
        if (own && !samePlace(own, current.arena)) {
            moveRun(current, own);
            return;
        }
        current.state = "pause";
        current.nextAt = Date.now() + 1200;
        return;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// The bell menu
// ---------------------------------------------------------------------------------------------------------------

// The bell menus that are open and active right now. A closed menu stays in memory for a while (game test: it
// was still found after closing, so the gauntlet screen never opened and a new menu got no entry).
function bellMenus() {
    const menuClass = UE.Class.Load(BELL_MENU_CLASS);
    if (!menuClass)
        return [];
    const found = puerts.$ref(UE.NewArray(UE.UserWidget));
    UE.WidgetBlueprintLibrary.GetAllWidgetsOfClass(player(), found, menuClass, false);
    const widgets = puerts.$unref(found), list = [];
    for (let i = 0; i < widgets.Num(); i++) {
        const widget = widgets.Get(i);
        if (valid(widget) && widget.IsActivated())
            list.push(widget);
    }
    return list;
}

const childrenOf = (box) => { const list = []; for (let i = 0; i < box.GetChildrenCount(); i++) list.push(box.GetChildAt(i)); return list; };
const slotOf = (widget) => ({ padding: widget.Slot.Padding, horizontal: widget.Slot.HorizontalAlignment, vertical: widget.Slot.VerticalAlignment, size: widget.Slot.Size });

function applySlot(widget, slot) {
    widget.Slot.SetPadding(slot.padding);
    widget.Slot.SetHorizontalAlignment(slot.horizontal);
    widget.Slot.SetVerticalAlignment(slot.vertical);
    widget.Slot.SetSize(slot.size);
}

// Gives our entry its text. The button sets its own texts again when it is built, so this is repeated.
function nameBellEntry(entry) {
    const text = toText(run && run.state == "stop" ? BELL_ENTRY_NEXT : BELL_ENTRY_TEXT);
    entry.bOverride_ButtonText = true;
    entry.ButtonText = text;
    entry.SetButtonText(text);
    entry.UpdateButtonText(text);
    entry.PBZCommonLocRichText_39.SetText(text);
    entry.Selected.SetText(text);
}

// Puts our entry into a bell menu: a button of the menu's own button class, at the end of its list. (Putting it
// below "Travel" means taking the entries after it out and back in, UMG has no insert; in the game test the last
// two of them came back in another font.)
function addBellEntry(bellMenu) {
    // The list is the vertical box above "Travel"; the button sits in it inside a wrapper (game test: an Overlay).
    // row: the list's own child that holds the button.
    const template = bellMenu.TeleportBtn;
    let row = template, box = template.GetParent();
    const chain = [];
    for (let level = 0; level < 8 && valid(box) && typeof box.AddChildToVerticalBox != "function"; level++) {
        chain.push(box.GetClass().GetName());
        row = box;
        box = box.GetParent();
    }
    if (!valid(box) || typeof box.AddChildToVerticalBox != "function")
        throw new Error("no vertical box above the Travel button (above it: " + chain.join(" > ") + ")");
    // An entry of ours that is already there goes first (game test: two "Gauntlets" entries). The game keeps a
    // closed bell menu and shows it again, with the entry an earlier opening or the mod before a reload put in.
    for (const child of childrenOf(box)) {
        const text = attempt("entry check", () => child.ButtonText ? String(UE.KismetTextLibrary.Conv_TextToString(child.ButtonText)) : "");
        if (text == BELL_ENTRY_TEXT || text == BELL_ENTRY_NEXT) {
            child.RemoveFromParent();
            log("bell menu: an earlier entry taken out");
        }
    }
    const pc = UE.GameplayStatics.GetPlayerController(gameInstance, 0);
    const entry = UE.WidgetBlueprintLibrary.Create(bellMenu, template.GetClass(), pc);
    box.AddChildToVerticalBox(entry);
    applySlot(entry, slotOf(row));
    attempt("entry text", () => nameBellEntry(entry));
    // A new button looks chosen until it has been left once (game test: "Gauntlets" was highlighted beside the
    // entry really chosen). It is told that it is neither chosen nor under the pointer.
    attempt("entry look", () => {
        const before = `selected ${entry.GetSelected()}, hovered ${entry.IsHovered()}`, told = [];
        if (entry.GetSelected())
            entry.SetIsSelected(false, false);
        for (const event of ["BP_OnDeselected", "BP_OnUnhovered"])
            if (typeof entry[event] == "function") {
                entry[event]();
                told.push(event);
            }
        log(`bell entry look: ${before}; told ${told.join(", ") || "nothing"}`);
    });
    entry.OnButtonBaseClicked.Add(() => attempt("bell entry click", () => {
        log("bell entry chosen");
        openAfterBell = true;
        bellMenu.ClickCloseButton();
    }));
    log(`bell menu: entry added at the end of ${box.GetChildrenCount()} rows`);
    // Where this bell is: the log collects the spots of the bells the player uses, for new arenas.
    attempt("bell spot", () => {
        const character = player(), at = character.K2_GetActorLocation();
        log(`bell spot: ${bellManager().RecentlyInteractedBellID} in ${String(UE.KismetSystemLibrary.GetPathName(character)).split(".")[0]}`
            + ` at ${Math.round(at.X)} ${Math.round(at.Y)} ${Math.round(at.Z)} yaw ${Math.round(character.K2_GetActorRotation().Yaw)}`);
    });
    return entry;
}

// Keeps our entry in the open bell menu: adds it when missing, keeps it in the menu's button group (the menu
// makes a new group each time it activates) and keeps the gamepad's up and down going through it.
function bellTick() {
    const menus = bellMenus();
    if (menus.length != bellMenuCount) {
        bellMenuCount = menus.length;
        log(`bell menus open: ${menus.length}`);
    }
    if (menus.length == 0) {
        bell = null;
        return;
    }
    // The newest menu is the one on screen (game test: after a gauntlet fight the entry was missing at the first
    // opening; an older menu of the game's may still count as open then).
    const bellMenu = menus[menus.length - 1];
    if (!valid(bellMenu.TeleportBtn) || !valid(bellMenu.TeleportBtn.GetParent()))
        return; // not built yet
    if (bell && bell.menu === bellMenu && bell.failed)
        return; // this menu refused the entry: not tried again, or it could end up with several
    if (!bell || bell.menu !== bellMenu || !valid(bell.entry) || !valid(bell.entry.GetParent())) {
        try {
            bell = { menu: bellMenu, entry: addBellEntry(bellMenu) };
        }
        catch (e) {
            bell = { menu: bellMenu, entry: null, failed: true };
            log("bell menu: the entry could not be added: " + e);
            return;
        }
    }
    if (!said.entryText)
        said.entryText = !attempt("entry text", () => { nameBellEntry(bell.entry); return true; });
    else
        try { nameBellEntry(bell.entry); } catch (e) { }
    attempt("bell group", () => {
        const group = bellMenu.GetButtonGroupByID("BellMenu");
        if (group && group.FindButtonIndex(bell.entry) < 0)
            group.AddWidget(bell.entry);
    });
    // Our entry is the last one: down from "Leave" reaches it, down from it goes round to the first visible entry.
    attempt("bell navigation", () => {
        const entry = bell.entry, last = bellMenu.CloseBtn;
        const first = [bellMenu.TeleportBtn_BrokenBell, bellMenu.TeleportBtn, bellMenu.ItemUpgradeButton].find((button) => valid(button) && button.IsVisible());
        entry.SetNavigationRuleExplicit(UE.EUINavigation.Up, last);
        last.SetNavigationRuleExplicit(UE.EUINavigation.Down, entry);
        if (first) {
            entry.SetNavigationRuleExplicit(UE.EUINavigation.Down, first);
            first.SetNavigationRuleExplicit(UE.EUINavigation.Up, entry);
        }
    });
}

function onKey() {
    if (journey)
        return;
    if (run && run.state == "stop")
        openMenu(run);
    else if (run)
        ask(`Give up ${run.gauntlet.name}?`, (yes) => {
            if (yes && run)
                conclude(finish(), "Run given up.");
        });
    else
        openMenu();
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

function tick() {
    const pc = UE.GameplayStatics.GetPlayerController(gameInstance, 0);
    if (journey) {
        journeyTick(pc);
        return;
    }
    if (!pc || !player()) {
        if (run) {
            log("no player: run dropped");
            run = null;
        }
        return;
    }
    if (menu) {
        menuTick(pc);
        return;
    }
    if (pending && !run && Date.now() >= pending.at && (inGameplay(pc) || Date.now() >= pending.at + 6000)) {
        const result = pending;
        pending = null;
        openResult(result);
        return;
    }
    if (run)
        runTick();
    const stopped = !!run && run.state == "stop";
    if ((!run || stopped) && ticks++ % BELL_EVERY == 0) {
        try {
            bellTick();
        }
        catch (e) {
            if (!said.bell)
                log("bell menu: " + e);
            said.bell = true;
        }
        if (openAfterBell && bellMenus().length == 0 && inGameplay(pc)) {
            openAfterBell = false;
            openMenu(stopped ? run : undefined);
            return;
        }
    }
    const down = pc.IsInputKeyDown(menuKey) || (pc.IsInputKeyDown(padHold) && pc.IsInputKeyDown(padPress));
    const pressed = down && !wasDown;
    wasDown = down;
    if (pressed && !(asking && Date.now() < askingUntil) && inGameplay(pc))
        onKey();
}

const timer = setInterval(() => {
    try {
        effectsTick();
        tick();
        errorSaid = false;
    }
    catch (e) {
        if (!errorSaid) {
            errorSaid = true;
            log("failed: " + e);
        }
        attempt("emergency end", finish); // a run must never keep the health floor or the slow motion
        attempt("emergency menu close", closeMenu); // nor the menu the player's input
    }
}, TICK_MS);

log(`started: press ${SETTINGS.KEY} (gamepad: L3 + D-pad up) for the gauntlets`);

exports.stop = function () {
    clearInterval(timer);
    pending = null;
    effects = [];
    hideLadder();
    attempt("card removal on stop", hideCard);
    attempt("menu close on stop", closeMenu);
    attempt("end on stop", finish);
    attempt("bell entry removal on stop", () => {
        if (bell && valid(bell.entry))
            bell.entry.RemoveFromParent();
        bell = null;
    });
    log("stopped");
};
