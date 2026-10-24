// TalkingApp — emoji data (unicode, no sprite dependency)
// Each entry: [char, ...shortcodes]

export const EMOJI_CATEGORIES = [
  {
    id: 'smileys',
    name: 'Smileys & People',
    icon: '😀',
    emojis: [
      ['😀', 'grinning'], ['😃', 'smiley'], ['😄', 'smile'], ['😁', 'grin'], ['😆', 'laughing', 'satisfied'],
      ['😅', 'sweat_smile'], ['🤣', 'rofl', 'rolling_on_the_floor_laughing'], ['😂', 'joy'], ['🙂', 'slight_smile'],
      ['🙃', 'upside_down'], ['😉', 'wink'], ['😊', 'blush'], ['😇', 'innocent'], ['🥰', 'smiling_hearts'],
      ['😍', 'heart_eyes'], ['🤩', 'star_struck'], ['😘', 'kissing_heart'], ['😗', 'kissing'], ['😚', 'kissing_closed_eyes'],
      ['😙', 'kissing_smiling_eyes'], ['🥲', 'smiling_tear'], ['😋', 'yum'], ['😛', 'stuck_out_tongue'],
      ['😜', 'stuck_out_tongue_winking_eye'], ['🤪', 'zany'], ['😝', 'stuck_out_tongue_closed_eyes'], ['🤑', 'money_mouth'],
      ['🤗', 'hugs'], ['🤭', 'hand_over_mouth'], ['🤫', 'shushing'], ['🤔', 'thinking'], ['🤐', 'zipper_mouth'],
      ['🤨', 'raised_eyebrow'], ['😐', 'neutral'], ['😑', 'expressionless'], ['😶', 'no_mouth'], ['😏', 'smirk'],
      ['😒', 'unamused'], ['🙄', 'roll_eyes'], ['😬', 'grimacing'], ['🤥', 'lying'], ['😌', 'relieved'],
      ['😔', 'pensive'], ['😪', 'sleepy'], ['🤤', 'drooling'], ['😴', 'sleeping'], ['😷', 'mask'],
      ['🤒', 'thermometer'], ['🤕', 'bandaged_head'], ['🤢', 'nauseated'], ['🤮', 'vomiting'], ['🤧', 'sneezing'],
      ['🥵', 'hot'], ['🥶', 'cold'], ['🥴', 'woozy'], ['😵', 'dizzy_face'], ['🤯', 'exploding_head'],
      ['🤠', 'cowboy'], ['🥳', 'party_face', 'partying'], ['🥺', 'pleading'], ['😎', 'sunglasses'], ['🤓', 'nerd'],
      ['🧐', 'monocle'], ['😕', 'confused'], ['😟', 'worried'], ['🙁', 'slight_frown'], ['😮', 'open_mouth'],
      ['😯', 'hushed'], ['😲', 'astonished'], ['😳', 'flushed'], ['🥱', 'yawning'], ['😦', 'frowning'],
      ['😧', 'anguished'], ['😨', 'fearful'], ['😰', 'cold_sweat'], ['😥', 'disappointed_relieved'], ['😢', 'cry'],
      ['😭', 'sob'], ['😱', 'scream'], ['😖', 'confounded'], ['😣', 'persevere'], ['😞', 'disappointed'],
      ['😓', 'sweat'], ['😩', 'weary'], ['😫', 'tired_face'], ['🥹', 'holding_back_tears'], ['😤', 'triumph'],
      ['😡', 'rage'], ['😠', 'angry'], ['🤬', 'cursing'], ['😈', 'smiling_imp'], ['👿', 'imp'],
      ['💀', 'skull'], ['☠️', 'skull_crossbones'], ['💩', 'poop'], ['🤡', 'clown'], ['👹', 'ogre'],
      ['👺', 'goblin'], ['👻', 'ghost'], ['👽', 'alien'], ['🤖', 'robot'], ['😺', 'smiley_cat'],
      ['🙈', 'see_no_evil'], ['🙉', 'hear_no_evil'], ['🙊', 'speak_no_evil'], ['👋', 'wave'], ['🤚', 'raised_back_of_hand'],
      ['✋', 'hand', 'raised_hand'], ['🖖', 'vulcan'], ['👌', 'ok_hand'], ['🤌', 'pinched_fingers'], ['🤏', 'pinching'],
      ['✌️', 'v'], ['🤞', 'crossed_fingers'], ['🤟', 'love_you'], ['🤘', 'metal'], ['🤙', 'call_me'],
      ['👈', 'point_left'], ['👉', 'point_right'], ['👆', 'point_up'], ['👇', 'point_down'], ['☝️', 'point_up_2'],
      ['👍', 'thumbsup', '+1'], ['👎', 'thumbsdown', '-1'], ['✊', 'fist'], ['👊', 'punch'], ['🤛', 'fist_left'],
      ['👏', 'clap'], ['🙌', 'raised_hands'], ['👐', 'open_hands'], ['🤲', 'palms_up'], ['🤝', 'handshake'],
      ['🙏', 'pray'], ['💅', 'nails'], ['💪', 'muscle'], ['🦾', 'mechanical_arm'], ['👀', 'eyes'],
      ['👁️', 'eye'], ['🧠', 'brain'], ['🫡', 'salute'], ['🫠', 'melting'], ['🫨', 'shaking'],
    ],
  },
  {
    id: 'nature',
    name: 'Animals & Nature',
    icon: '🐻',
    emojis: [
      ['🐶', 'dog'], ['🐱', 'cat'], ['🐭', 'mouse'], ['🐹', 'hamster'], ['🐰', 'rabbit'], ['🦊', 'fox'],
      ['🐻', 'bear'], ['🐼', 'panda'], ['🐨', 'koala'], ['🐯', 'tiger'], ['🦁', 'lion'], ['🐮', 'cow'],
      ['🐷', 'pig'], ['🐸', 'frog'], ['🐵', 'monkey_face'], ['🐔', 'chicken'], ['🐧', 'penguin'], ['🐦', 'bird'],
      ['🦆', 'duck'], ['🦅', 'eagle'], ['🦉', 'owl'], ['🦇', 'bat'], ['🐺', 'wolf'], ['🐴', 'horse'],
      ['🦄', 'unicorn'], ['🐝', 'bee'], ['🦋', 'butterfly'], ['🐌', 'snail'], ['🐛', 'bug'], ['🐜', 'ant'],
      ['🕷️', 'spider'], ['🐢', 'turtle'], ['🐍', 'snake'], ['🦎', 'lizard'], ['🐙', 'octopus'], ['🦑', 'squid'],
      ['🦐', 'shrimp'], ['🦀', 'crab'], ['🐡', 'blowfish'], ['🐠', 'fish'], ['🐟', 'fish2'], ['🐬', 'dolphin'],
      ['🐳', 'whale'], ['🦈', 'shark'], ['🐊', 'crocodile'], ['🐅', 'tiger2'], ['🦓', 'zebra'], ['🦒', 'giraffe'],
      ['🐘', 'elephant'], ['🦏', 'rhino'], ['🐪', 'camel'], ['🦙', 'llama'], ['🐕', 'dog2'], ['🐈', 'cat2'],
      ['🪶', 'feather'], ['🐉', 'dragon'], ['🌵', 'cactus'], ['🎄', 'christmas_tree'], ['🌲', 'evergreen'],
      ['🌳', 'deciduous_tree'], ['🌴', 'palm_tree'], ['🌱', 'seedling'], ['🌿', 'herb'], ['☘️', 'shamrock'],
      ['🍀', 'four_leaf_clover'], ['🍁', 'maple_leaf'], ['🍂', 'fallen_leaf'], ['🍃', 'leaves'], ['🍄', 'mushroom'],
      ['🌾', 'ear_of_rice'], ['💐', 'bouquet'], ['🌷', 'tulip'], ['🌹', 'rose'], ['🌺', 'hibiscus'],
      ['🌸', 'cherry_blossom'], ['🌼', 'blossom'], ['🌻', 'sunflower'], ['🌞', 'sun_with_face'], ['🌝', 'full_moon_face'],
      ['🌚', 'new_moon_face'], ['🌙', 'moon'], ['⭐', 'star'], ['🌟', 'star2'], ['✨', 'sparkles'],
      ['⚡', 'zap'], ['🔥', 'fire'], ['💥', 'boom'], ['❄️', 'snowflake'], ['🌈', 'rainbow'],
      ['☀️', 'sunny'], ['⛅', 'partly_sunny'], ['☁️', 'cloud'], ['🌧️', 'rain_cloud'], ['⛈️', 'thunder_cloud'],
      ['🌨️', 'snow_cloud'], ['🌪️', 'tornado'], ['🌊', 'ocean'], ['💧', 'droplet'], ['🌍', 'earth_africa'],
    ],
  },
  {
    id: 'food',
    name: 'Food & Drink',
    icon: '🍕',
    emojis: [
      ['🍏', 'green_apple'], ['🍎', 'apple'], ['🍐', 'pear'], ['🍊', 'tangerine'], ['🍋', 'lemon'],
      ['🍌', 'banana'], ['🍉', 'watermelon'], ['🍇', 'grapes'], ['🍓', 'strawberry'], ['🫐', 'blueberries'],
      ['🍈', 'melon'], ['🍒', 'cherries'], ['🍑', 'peach'], ['🥭', 'mango'], ['🍍', 'pineapple'],
      ['🥥', 'coconut'], ['🥝', 'kiwi'], ['🍅', 'tomato'], ['🥑', 'avocado'], ['🥦', 'broccoli'],
      ['🥕', 'carrot'], ['🌽', 'corn'], ['🌶️', 'hot_pepper'], ['🫑', 'bell_pepper'], ['🥒', 'cucumber'],
      ['🧄', 'garlic'], ['🧅', 'onion'], ['🥔', 'potato'], ['🍠', 'sweet_potato'], ['🥐', 'croissant'],
      ['🥯', 'bagel'], ['🍞', 'bread'], ['🧇', 'waffle'], ['🥞', 'pancakes'], ['🍳', 'fried_egg'],
      ['🧀', 'cheese'], ['🍖', 'meat_on_bone'], ['🍗', 'poultry_leg'], ['🥩', 'cut_of_meat'], ['🥓', 'bacon'],
      ['🍔', 'hamburger'], ['🍟', 'fries'], ['🍕', 'pizza'], ['🌭', 'hotdog'], ['🥪', 'sandwich'],
      ['🌮', 'taco'], ['🌯', 'burrito'], ['🥙', 'stuffed_flatbread'], ['🧆', 'falafel'], ['🥘', 'paella'],
      ['🍝', 'spaghetti'], ['🍜', 'ramen'], ['🍲', 'stew'], ['🍣', 'sushi'], ['🍱', 'bento'],
      ['🥟', 'dumpling'], ['🍤', 'fried_shrimp'], ['🍙', 'rice_ball'], ['🍚', 'rice'], ['🍛', 'curry'],
      ['🍦', 'icecream'], ['🍧', 'shaved_ice'], ['🍨', 'ice_cream'], ['🍩', 'doughnut'], ['🍪', 'cookie'],
      ['🎂', 'cake'], ['🍰', 'birthday', 'shortcake'], ['🧁', 'cupcake'], ['🥧', 'pie'], ['🍫', 'chocolate_bar'],
      ['🍬', 'candy'], ['🍭', 'lollipop'], ['🍮', 'custard'], ['🍯', 'honey'], ['☕', 'coffee'],
      ['🍵', 'tea'], ['🧋', 'bubble_tea'], ['🥤', 'cup_straw'], ['🍺', 'beer'], ['🍻', 'beers'],
      ['🥂', 'clinking_glasses'], ['🍷', 'wine_glass'], ['🥃', 'tumbler_glass'], ['🍸', 'cocktail'], ['🍹', 'tropical_drink'],
      ['🧊', 'ice_cube'], ['🥛', 'milk'],
    ],
  },
  {
    id: 'activity',
    name: 'Activities & Objects',
    icon: '🎮',
    emojis: [
      ['⚽', 'soccer'], ['🏀', 'basketball'], ['🏈', 'football'], ['⚾', 'baseball'], ['🥎', 'softball'],
      ['🎾', 'tennis'], ['🏐', 'volleyball'], ['🏉', 'rugby'], ['🎱', '8ball'], ['🏓', 'ping_pong'],
      ['🏸', 'badminton'], ['🥊', 'boxing_glove'], ['🥋', 'martial_arts'], ['⛳', 'golf'], ['⛸️', 'ice_skate'],
      ['🎿', 'ski'], ['🛷', 'sled'], ['🏂', 'snowboarder'], ['🏆', 'trophy'], ['🥇', 'first_place'],
      ['🥈', 'second_place'], ['🥉', 'third_place'], ['🏅', 'medal'], ['🎖️', 'military_medal'], ['🎗️', 'reminder_ribbon'],
      ['🎯', 'dart'], ['🎮', 'video_game'], ['🕹️', 'joystick'], ['🎲', 'game_die'], ['♟️', 'chess_pawn'],
      ['🎰', 'slot_machine'], ['🧩', 'jigsaw'], ['🎨', 'art'], ['🖌️', 'brush'], ['🖍️', 'crayon'],
      ['🎤', 'microphone2'], ['🎧', 'headphones'], ['🎼', 'musical_score'], ['🎵', 'musical_note'], ['🎶', 'notes'],
      ['🎹', 'musical_keyboard'], ['🥁', 'drum'], ['🎸', 'guitar'], ['🎺', 'trumpet'], ['🎷', 'saxophone'],
      ['🎬', 'clapper'], ['🎭', 'performing_arts'], ['🎪', 'circus_tent'], ['🎟️', 'tickets'], ['🎫', 'ticket'],
      ['📸', 'camera_flash'], ['📷', 'camera'], ['🎥', 'movie_camera'], ['📺', 'tv'], ['📻', 'radio'],
      ['💻', 'computer'], ['🖥️', 'desktop'], ['⌨️', 'keyboard'], ['🖱️', 'computer_mouse'], ['💾', 'floppy_disk'],
      ['💿', 'cd'], ['📀', 'dvd'], ['📱', 'iphone'], ['📞', 'telephone_receiver'], ['☎️', 'telephone'],
      ['🔋', 'battery'], ['🔌', 'electric_plug'], ['💡', 'bulb'], ['🔦', 'flashlight'], ['🕯️', 'candle'],
      ['🧭', 'compass'], ['⏰', 'alarm_clock'], ['⌚', 'watch'], ['🔒', 'lock'], ['🔓', 'unlock'],
      ['🔑', 'key'], ['🗝️', 'old_key'], ['🔨', 'hammer'], ['🪓', 'axe'], ['⛏️', 'pick'],
      ['🔧', 'wrench'], ['🪛', 'screwdriver'], ['⚙️', 'gear'], ['🧲', 'magnet'], ['🪜', 'ladder'],
      ['🧪', 'test_tube'], ['🧬', 'dna'], ['🔬', 'microscope'], ['🔭', 'telescope'], ['📡', 'satellite'],
      ['💊', 'pill'], ['💉', 'syringe'], ['🩹', 'adhesive_bandage'], ['🩺', 'stethoscope'], ['🧹', 'broom'],
      ['🧺', 'basket'], ['🧻', 'roll_of_paper'], ['🚽', 'toilet'], ['🛁', 'bathtub'], ['🪥', 'toothbrush'],
      ['🎁', 'gift'], ['🎈', 'balloon'], ['🎉', 'tada'], ['🎊', 'confetti_ball'], ['🪅', 'pinata'],
      ['🪩', 'mirror_ball'], ['📦', 'package'], ['📫', 'mailbox'], ['📝', 'memo'], ['📚', 'books'],
      ['📖', 'book'], ['📓', 'notebook'], ['📒', 'ledger'], ['📰', 'newspaper'], ['🗞️', 'newspaper2'],
      ['🏷️', 'label'], ['💰', 'moneybag'], ['💳', 'credit_card'], ['💎', 'gem'], ['⚖️', 'scales'],
    ],
  },
  {
    id: 'symbols',
    name: 'Symbols & Hearts',
    icon: '❤️',
    emojis: [
      ['❤️', 'heart', 'red_heart'], ['🧡', 'orange_heart'], ['💛', 'yellow_heart'], ['💚', 'green_heart'],
      ['💙', 'blue_heart'], ['💜', 'purple_heart'], ['🖤', 'black_heart'], ['🤍', 'white_heart'],
      ['🤎', 'brown_heart'], ['💔', 'broken_heart'], ['❣️', 'heavy_heart_exclamation'], ['💕', 'two_hearts'],
      ['💞', 'revolving_hearts'], ['💓', 'heartbeat'], ['💗', 'heartpulse'], ['💖', 'sparkling_heart'],
      ['💘', 'cupid'], ['💝', 'gift_heart'], ['💟', 'heart_decoration'], ['💯', '100'], ['🔥', 'fire2'],
      ['✅', 'white_check_mark'], ['☑️', 'ballot_box_with_check'], ['✔️', 'heavy_check_mark'], ['❌', 'x'],
      ['❎', 'negative_squared_cross_mark'], ['➕', 'heavy_plus_sign'], ['➖', 'heavy_minus_sign'], ['➗', 'heavy_division_sign'],
      ['✖️', 'heavy_multiplication_x'], ['♻️', 'recycle'], ['🔴', 'red_circle'], ['🟠', 'orange_circle'],
      ['🟡', 'yellow_circle'], ['🟢', 'green_circle'], ['🔵', 'blue_circle'], ['🟣', 'purple_circle'],
      ['⚫', 'black_circle'], ['⚪', 'white_circle'], ['🟥', 'red_square'], ['🟧', 'orange_square'],
      ['🟨', 'yellow_square'], ['🟩', 'green_square'], ['🟦', 'blue_square'], ['🟪', 'purple_square'],
      ['⬛', 'black_large_square'], ['⬜', 'white_large_square'], ['🔶', 'large_orange_diamond'], ['🔷', 'large_blue_diamond'],
      ['🔺', 'small_red_triangle'], ['🔻', 'small_red_triangle_down'], ['💠', 'diamond_shape_with_a_dot_inside'], ['🔔', 'bell'],
      ['🔕', 'no_bell'], ['📣', 'loudspeaker'], ['📢', 'mega'], ['🔊', 'loud_sound'], ['🔇', 'mute'],
      ['💤', 'zzz'], ['💬', 'speech_balloon'], ['💭', 'thought_balloon'], ['🗯️', 'right_anger_bubble'], ['🗨️', 'left_speech_bubble'],
      ['⚠️', 'warning'], ['🚫', 'no_entry_sign'], ['⛔', 'no_entry'], ['📛', 'name_badge'], ['🔞', 'underage'],
      ['☢️', 'radioactive'], ['☣️', 'biohazard'], ['🆗', 'ok'], ['🆒', 'cool'], ['🆕', 'new'],
      ['🆓', 'free'], ['🔝', 'top'], ['🔙', 'back'], ['🔜', 'soon'], ['🔚', 'end'],
      ['💯', 'hundred'], ['♾️', 'infinity'], ['🎵', 'music'], ['🔱', 'trident'], ['⚜️', 'fleur_de_lis'],
      ['🔰', 'beginner'], ['⭕', 'o'], ['✨', 'sparkle'], ['⭐', 'star2x'], ['🏳️', 'white_flag'],
      ['🏴', 'black_flag'], ['🏁', 'checkered_flag'], ['🚩', 'triangular_flag'], ['🎌', 'crossed_flags'], ['🏳️‍🌈', 'rainbow_flag'],
      ['♠️', 'spades'], ['♥️', 'hearts'], ['♦️', 'diamonds'], ['♣️', 'clubs'], ['🃏', 'black_joker'],
    ],
  },
];

export const ALL_EMOJIS = EMOJI_CATEGORIES.flatMap((c) => c.emojis.map((e) => ({ char: e[0], codes: e.slice(1), cat: c.id })));

const SHORTCODE_MAP = new Map();
for (const e of ALL_EMOJIS) for (const code of e.codes) if (!SHORTCODE_MAP.has(code)) SHORTCODE_MAP.set(code, e.char);

export const RECENT_EMOJI_KEY = 'ta.emoji.recent';

export function searchEmojis(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return ALL_EMOJIS;
  return ALL_EMOJIS.filter((e) => e.codes.some((c) => c.includes(q)) || e.char === q);
}

export function shortcodeToEmoji(code) {
  return SHORTCODE_MAP.get(code) || null;
}

/** Replace :shortcodes: in plain text. */
export function emojify(text) {
  return String(text).replace(/:([a-z0-9_+-]{2,32}):/gi, (m, code) => SHORTCODE_MAP.get(code.toLowerCase()) || m);
}

/** Return suggestions for a partial shortcode (no leading colon). */
export function suggestShortcodes(partial, limit = 8) {
  const q = partial.toLowerCase();
  if (!q) return [];
  const out = [];
  for (const e of ALL_EMOJIS) {
    for (const c of e.codes) {
      if (c.startsWith(q)) { out.push({ char: e.char, code: c }); break; }
    }
    if (out.length >= limit) break;
  }
  return out;
}

export function readRecentEmojis() {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_EMOJI_KEY) || '[]');
    return Array.isArray(v) ? v.slice(0, 24) : [];
  } catch { return []; }
}

export function pushRecentEmoji(char) {
  try {
    const list = readRecentEmojis().filter((c) => c !== char);
    list.unshift(char);
    localStorage.setItem(RECENT_EMOJI_KEY, JSON.stringify(list.slice(0, 24)));
  } catch {}
}
