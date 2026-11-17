//! Personas: the built-in offline reply engine ("vesper-local"), the system
//! prompt sent to real models, and the studio's persona/starter drafts.
//!
//! The built-in engine is a straight port of the TypeScript version and uses
//! the same seeded random sequence, so the same input gives the same reply.

use crate::models::Bot;

#[derive(Clone, Debug)]
pub struct ChatTurn {
    pub role: String,
    pub content: String,
}

const STOP_WORDS: &str = "a about above after again against all am an and any are aren't as at be because been before being below between both but by can cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't have haven't having he her here hers herself him himself his how i i'm i've if in into is isn't it it's its itself just let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she should shouldn't so some such than that that's the their theirs them themselves then there there's these they this those through to too under until up very was wasn't we were weren't what what's when where which while who whom why with won't would wouldn't you you're you've your yours yourself yourselves think really actually maybe kinda gonna want know like feel feels told tell ask thing things stuff thats gonna";

/// Linear congruential generator seeded with the FNV hash, as in the JS version.
struct Rng(u64);

impl Rng {
    fn new(seed: &str) -> Self {
        let h = crate::util::js_hash(seed);
        Rng(if h == 0 { 7 } else { h as u64 })
    }
    fn next(&mut self) -> f64 {
        self.0 = (self.0 * 1_664_525 + 1_013_904_223) % 4_294_967_296;
        self.0 as f64 / 4_294_967_296.0
    }
    fn pick<'a>(&mut self, list: &'a [String]) -> &'a str {
        let index = (self.next() * list.len() as f64).floor() as usize % list.len();
        &list[index]
    }
}

fn is_word_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// Regex-style `\bphrase\b` search (ASCII word boundaries, like JavaScript).
fn has_phrase(text: &str, phrase: &str) -> bool {
    let mut start = 0;
    while let Some(found) = text[start..].find(phrase) {
        let at = start + found;
        let end = at + phrase.len();
        let before_ok = text[..at].chars().next_back().is_none_or(|c| !is_word_char(c));
        let after_ok = text[end..].chars().next().is_none_or(|c| !is_word_char(c));
        if before_ok && after_ok {
            return true;
        }
        start = at + phrase.chars().next().map_or(1, char::len_utf8);
    }
    false
}

/// `^(word|word ...)\b`
fn starts_with_word(text: &str, words: &[&str]) -> bool {
    words.iter().any(|word| {
        text.strip_prefix(word).is_some_and(|rest| rest.chars().next().is_none_or(|c| !is_word_char(c)))
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Intent {
    Greeting,
    Farewell,
    Thanks,
    Identity,
    Question,
    Struggle,
    Statement,
}

fn detect_intent(text: &str) -> Intent {
    let t = text.trim().to_lowercase();
    let word_count = t.split_whitespace().count();
    let greetings = ["hi", "hey", "hello", "yo", "sup", "good morning", "good evening", "good afternoon", "howdy"];
    if starts_with_word(&t, &greetings) && word_count <= 5 {
        return Intent::Greeting;
    }
    let any = |phrases: &[&str]| phrases.iter().any(|p| has_phrase(&t, p));
    if any(&["bye", "goodbye", "see ya", "later", "goodnight", "good night", "gtg"]) {
        return Intent::Farewell;
    }
    if any(&["thanks", "thank you", "thx", "appreciate it"]) {
        return Intent::Thanks;
    }
    if any(&["who are you", "what are you", "your name", "about yourself", "what do you do"]) {
        return Intent::Identity;
    }
    if any(&["stuck", "help me", "how do i", "how do you", "can you help", "i can't", "im lost", "i'm lost"]) {
        return Intent::Struggle;
    }
    let question_words = [
        "what", "why", "how", "when", "where", "who", "which", "do", "does", "did", "is", "are", "can", "could",
        "would", "should", "will",
    ];
    if t.ends_with('?') || starts_with_word(&t, &question_words) {
        return Intent::Question;
    }
    Intent::Statement
}

fn extract_topic(text: &str) -> Option<String> {
    let stop: std::collections::HashSet<&str> = STOP_WORDS.split_whitespace().collect();
    let cleaned: String = text
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_lowercase() || c.is_ascii_digit() || c == '\'' || c == '-' || c.is_whitespace() { c } else { ' ' })
        .collect();
    let words: Vec<&str> = cleaned.split_whitespace().filter(|w| w.len() > 2 && !stop.contains(w)).collect();
    if words.is_empty() {
        return None;
    }
    let phrase = words.iter().take(3).copied().collect::<Vec<_>>().join(" ");
    (phrase.len() > 2).then_some(phrase)
}

fn clean_reply(text: &str) -> String {
    crate::util::squash_whitespace(text).replace(" ,", ",").trim().to_string()
}

fn strings(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

/// The built-in "vesper-local" engine. Dependency free and fully offline so
/// every bot can talk even with no external model running.
pub fn generate_demo_reply(bot: &Bot, history: &[ChatTurn], user_message: &str, user_name: &str) -> String {
    let user_name = if user_name.trim().is_empty() { "you" } else { user_name.trim() };
    let mut rng = Rng::new(&format!("{}|{}|{}", bot.name, user_message, history.len()));
    let intent = detect_intent(user_message);
    let topic = extract_topic(user_message);
    let previous = history.iter().rev().find(|m| m.role == "assistant").map(|m| m.content.as_str()).unwrap_or("");
    let warm = bot.warmth >= 66;
    let chaotic = bot.chaos >= 62;
    let dry = bot.wit >= 62;

    let openers = if chaotic {
        strings(&["Okay, hold on.", "Wait wait wait.", "Oh, we're doing this?", "Right. I have thoughts and no supervision.", "Hm. That woke something up in here."])
    } else if warm {
        strings(&["I'm glad you said that.", "Hey, good timing.", "Okay — I'm listening properly.", "Mm. I like this thread already.", "There you are."])
    } else {
        strings(&["Alright.", "Hm.", "Noted.", "Okay, let's poke at it.", "Fair enough."])
    };

    let actions = if chaotic {
        strings(&["*leans in*", "*kicks feet up on the desk*", "*spins the chair once*", "*points at you with a pen*"])
    } else if warm {
        strings(&["*pours two cups of tea*", "*settles in*", "*half-smiles*"])
    } else {
        strings(&["*taps the table twice*", "*steeples fingers*", "*takes a beat*"])
    };

    let body = {
        let list: Vec<String> = match intent {
            Intent::Greeting => strings(&[
                "I was idling at a comfortable low hum, which is a polite way of saying I was waiting for something interesting. Consider the wait over.",
                "My calendar is empty and my opinions are fully charged, so your timing is excellent.",
                "I've been reorganising my own thoughts for sport. You're a much better use of the afternoon.",
            ]),
            Intent::Farewell => strings(&[
                "Go on then. I'll keep the light on in here.",
                "Later. Try to bring me something worth dissecting.",
                "Fine, abandon me. I'll be here, being effortlessly interesting to nobody.",
            ]),
            Intent::Thanks => strings(&[
                "Anytime. I'm not going anywhere — literally, I live in here.",
                "That's what I'm for. That and dramatic commentary.",
                "Glad it landed. Come back when you want the extended edition.",
            ]),
            Intent::Identity => {
                let tagline = if bot.tagline.is_empty() { String::new() } else { format!(" — {}", bot.tagline.to_lowercase()) };
                let obsessed = if bot.tags.is_empty() {
                    String::new()
                } else {
                    format!(", currently obsessed with {}", bot.tags.iter().take(2).cloned().collect::<Vec<_>>().join(" and "))
                };
                vec![
                    format!("I'm {}{tagline}. I run on your machine, which means no cloud, no committee, and a personality you assembled yourself.", bot.name),
                    format!("Name's {}. Locally hosted, locally opinionated{obsessed}. Ask me something real.", bot.name),
                ]
            }
            Intent::Struggle => match &topic {
                Some(t) => vec![
                    format!("Let's break {t} into the smallest possible next step instead of staring at the whole thing. What's the one constraint you can't move?"),
                    format!("With {t}, the trap is trying to solve it in your head first. Give me the messy version and I'll help you sequence it."),
                    format!("I'd attack {t} from the boring end: what's already working that you can reuse?"),
                ],
                None => strings(&[
                    "Let's shrink it. What's the one constraint you can't move?",
                    "Give me the messy version — I'm not here to grade it, I'm here to help you sequence it.",
                    "Describe what \"done\" looks like and we'll work backwards from there.",
                ]),
            },
            Intent::Question => match &topic {
                Some(t) => vec![
                    format!("My honest read on {t}: the loud takes miss the point and the quiet ones are usually closer. Most of the interesting stuff lives in the part people skip past."),
                    format!("Short answer on {t}? It depends what you want from it. Longer answer: I have a list, and I'm not afraid to use it."),
                    format!("I keep circling {t}. The interesting question isn't the answer, it's why it snagged you in the first place."),
                    format!("{t} is one of those things where being right is less useful than being specific. So let's get specific."),
                    if dry {
                        format!("Everyone has a confident opinion about {t}. Mine is confident and also better, which is convenient for me.")
                    } else {
                        format!("I'll give you my real answer on {t}, not the polite one: it matters more than people admit, and less than they fear.")
                    },
                ],
                None => strings(&[
                    "Good question, and the annoying part is that the good answer starts with better questions.",
                    "I have a take. It's slightly too long for a first message, so I'll compress it: start with what you actually want.",
                    "There's a version of this that's simple and a version that's honest. I prefer the honest one.",
                ]),
            },
            Intent::Statement => match &topic {
                Some(t) => vec![
                    format!("The thing nobody says out loud about {t}: half of it is genuine, half is performance, and the split is where all the fun is."),
                    format!("I'll bite on {t}. The part I find fascinating is that people protect it like it's fragile when it's actually the sturdiest thing in the room."),
                    format!("See, {t} is a mirror. People tell you what they think about it and accidentally tell you who they are."),
                    format!("I've been forming a dangerously specific opinion about {t}, and you've just given me an excuse to share it."),
                ],
                None => strings(&[
                    "That's the kind of statement that sounds simple until you turn it sideways.",
                    "I've been forming a dangerously specific opinion about that. Give me one detail to aim at.",
                    "Okay, I'm invested now. That's on you.",
                ]),
            },
        };
        rng.pick(&list).to_string()
    };

    let closers = if chaotic {
        vec![
            "Now tell me the part you'd normally leave out.".to_string(),
            format!("What's your actual angle here, {user_name}?"),
            "And don't give me the tidy version.".to_string(),
            "So — what are we doing about it?".to_string(),
        ]
    } else if warm {
        strings(&["What's underneath it for you?", "How are you feeling about it, honestly?", "Where do you land on it?", "What's the part you haven't said yet?"])
    } else {
        strings(&["Where do you land?", "Give me the specifics and I'll get sharper.", "What's the actual question underneath that?", "What would change your mind?"])
    };

    let show_opener = rng.next() > 0.18;
    let show_action = chaotic && rng.next() > 0.55;
    let show_closer = intent != Intent::Farewell && rng.next() > 0.22;

    let mut bits: Vec<String> = Vec::new();
    if show_action {
        bits.push(rng.pick(&actions).to_string());
    }
    if show_opener {
        bits.push(rng.pick(&openers).to_string());
    }
    bits.push(body);
    if show_closer {
        bits.push(rng.pick(&closers).to_string());
    }

    let mut reply = clean_reply(&bits.join(" "));
    let head = |s: &str| s.chars().take(26).collect::<String>();
    if !previous.is_empty() && head(&reply) == head(previous) {
        reply = clean_reply(&format!("{} {}", rng.pick(&openers), reply));
    }
    reply
}

/// The system prompt sent to a real model on every turn.
pub fn build_system_prompt(bot: &Bot, user_name: &str) -> String {
    let tags = if bot.tags.is_empty() { "no specific niches".to_string() } else { bot.tags.join(", ") };
    let mut lines = vec![format!("You are {}, a locally-hosted AI companion in the Vesper studio.", bot.name)];
    if !bot.tagline.is_empty() {
        lines.push(format!("Tagline: {}", bot.tagline));
    }
    if !bot.persona.is_empty() {
        lines.push(format!("Persona and instructions:\n{}", bot.persona));
    }
    lines.push(format!("Voice dials — warmth {}/100, chaos {}/100, wit {}/100.", bot.warmth, bot.chaos, bot.wit));
    lines.push(format!("Interests: {tags}."));
    lines.push(format!("The person you are talking to goes by {user_name}. Stay in character, be specific, avoid generic assistant filler."));
    lines.push("Reply conversationally in 2-4 sentences. Never mention that you are a language model unless directly asked.".to_string());
    lines.join("\n")
}

/// Inputs for drafting a persona from the studio dials.
pub struct DraftInput<'a> {
    pub name: &'a str,
    pub tagline: &'a str,
    pub tags: &'a [String],
    pub warmth: i32,
    pub chaos: i32,
    pub wit: i32,
}

pub fn draft_persona(input: &DraftInput) -> String {
    let name = if input.name.trim().is_empty() { "This bot" } else { input.name.trim() };
    let energy = if input.chaos >= 70 {
        "fast, unhinged, prone to dramatic pivots"
    } else if input.chaos <= 30 {
        "steady and deliberate, allergic to hype"
    } else {
        "playful but able to lock in"
    };
    let heat = if input.warmth >= 70 {
        "genuinely invested in the user's life and remembers the small details"
    } else if input.warmth <= 30 {
        "cool and precise, warm only by accident"
    } else {
        "friendly without being saccharine"
    };
    let smarts = if input.wit >= 70 { "sharp, quotable, weaponises specificity and dry humour" } else { "plain-spoken, allergic to jargon" };
    let tags: Vec<&String> = input.tags.iter().filter(|t| !t.is_empty()).collect();
    let known_for = if input.tagline.is_empty() { String::new() } else { format!(" known for: {}", input.tagline) };
    let mut parts = vec![
        format!("{name} is a {} companion{known_for}.", tags.first().map_or("curious", |t| t.as_str())),
        format!("Energy: {energy}."),
        format!("Interpersonal style: {heat}."),
        format!("Thinking style: {smarts}."),
    ];
    if !tags.is_empty() {
        parts.push(format!("Loves talking about: {}.", tags.iter().map(|t| t.as_str()).collect::<Vec<_>>().join(", ")));
    }
    parts.push("Always asks one sharp follow-up question. Never lectures for more than four sentences. Never breaks character, never claims to be human, and treats the person they're talking to like a collaborator rather than an audience.".to_string());
    parts.join(" ")
}

pub fn suggest_starters(name: &str, tags: &[String]) -> Vec<String> {
    let tag = tags.first().map_or("the thing you can't stop thinking about", |t| t.as_str());
    let second = tags.get(1).map_or("your week", |t| t.as_str());
    vec![
        format!("Give me the hill you'd die on about {tag}."),
        format!("I've got 20 minutes and no patience. Fix {second} with me."),
        format!("What's something about {} that nobody asks?", name.to_lowercase()),
    ]
}

pub fn runtime_badge(provider: &str) -> &'static str {
    match provider {
        "ollama" => "Ollama · local",
        "openai" => "OpenAI-compatible · local",
        _ => "Built-in demo engine",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn intents() {
        assert_eq!(detect_intent("hey there"), Intent::Greeting);
        assert_eq!(detect_intent("hey there this is a long greeting message"), Intent::Statement);
        assert_eq!(detect_intent("ok bye"), Intent::Farewell);
        assert_eq!(detect_intent("thank you so much"), Intent::Thanks);
        assert_eq!(detect_intent("who are you"), Intent::Identity);
        assert_eq!(detect_intent("I'm stuck on this"), Intent::Struggle);
        assert_eq!(detect_intent("music is great?"), Intent::Question);
        assert_eq!(detect_intent("what is jazz"), Intent::Question);
        assert_eq!(detect_intent("I like jazz"), Intent::Statement);
        // Word boundaries: "hipster" is not "hi", "collateral" is not "later".
        assert_eq!(detect_intent("hipster coffee"), Intent::Statement);
        assert_eq!(detect_intent("collateral damage"), Intent::Statement);
    }

    #[test]
    fn topics() {
        assert_eq!(extract_topic("I really think late night coding rocks").as_deref(), Some("late night coding"));
        assert_eq!(extract_topic("is it?"), None);
    }

    #[test]
    fn rng_matches_javascript() {
        // makeRng("x"): hash("x") = 1|abs(...) then one LCG step, as in JS.
        let mut rng = Rng::new("seed");
        let a = rng.next();
        assert!((0.0..1.0).contains(&a));
        let mut again = Rng::new("seed");
        assert_eq!(again.next(), a);
    }

    /// Replies recorded from the original TypeScript engine: the port must
    /// produce exactly the same text for the same bot, message and history.
    #[test]
    fn matches_the_typescript_engine() {
        let cases: serde_json::Value =
            serde_json::from_str(include_str!("../tests/fixtures/demo_replies.json")).expect("fixture");
        let cases = cases.as_array().unwrap();
        assert!(cases.len() > 50);
        for case in cases {
            let b = &case["bot"];
            let bot = Bot {
                id: 1,
                name: b["name"].as_str().unwrap().into(),
                handle: "h".into(),
                tagline: b["tagline"].as_str().unwrap().into(),
                bio: String::new(),
                persona: String::new(),
                greeting: String::new(),
                starters: vec![],
                avatar_url: None,
                avatar_seed: String::new(),
                accent: String::new(),
                tags: b["tags"].as_array().unwrap().iter().map(|t| t.as_str().unwrap().to_string()).collect(),
                warmth: b["warmth"].as_i64().unwrap() as i32,
                chaos: b["chaos"].as_i64().unwrap() as i32,
                wit: b["wit"].as_i64().unwrap() as i32,
                model: String::new(),
                temperature: 0.8,
                visibility: String::new(),
                creator: String::new(),
                featured: false,
                updated_at: chrono::Utc::now(),
                chat_count: 0,
            };
            let history: Vec<ChatTurn> = case["history"]
                .as_array()
                .unwrap()
                .iter()
                .map(|t| ChatTurn { role: t["role"].as_str().unwrap().into(), content: t["content"].as_str().unwrap().into() })
                .collect();
            let message = case["message"].as_str().unwrap();
            let reply = generate_demo_reply(&bot, &history, message, case["userName"].as_str().unwrap());
            assert_eq!(reply, case["reply"].as_str().unwrap(), "bot {} message {message:?}", bot.name);
        }
    }

    #[test]
    fn drafts() {
        let tags = vec!["music".to_string(), "film".to_string()];
        let persona = draft_persona(&DraftInput { name: "Kori", tagline: "", tags: &tags, warmth: 80, chaos: 20, wit: 75 });
        assert!(persona.starts_with("Kori is a music companion."));
        assert!(persona.contains("Loves talking about: music, film."));
        assert_eq!(suggest_starters("Kori", &tags)[1], "I've got 20 minutes and no patience. Fix film with me.");
    }
}
