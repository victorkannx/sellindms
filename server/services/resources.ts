export type ResourceGuide = {
  eyebrow: string;
  intro: string;
  sections: Array<{
    title: string;
    copy: string;
    bullets?: string[];
  }>;
  searchPrompts: Array<{
    label: string;
    query: string;
  }>;
};

const guides: Record<string, ResourceGuide> = {
  'sell-in-dms-quick-reference': {
    eyebrow: 'FIELD REFERENCE',
    intro: 'Use this when you need a fast reset before replying. Find the moment, choose the matching response, then take one clear next move.',
    sections: [
      {
        title: 'Before you reply',
        copy: 'Read the last customer message once, then name the moment in plain language before you search.',
        bullets: ['What did they actually ask or say?', 'Are they interested, unsure, objecting, or silent?', 'What is the smallest useful next move?'],
      },
      {
        title: 'While you use a script',
        copy: 'Open the script that matches the situation. Keep its intent, but make the wording sound like you and fit your offer.',
        bullets: ['Use the reply as a starting point, not a pressure tactic.', 'Read the “Why it works” and “Next move” before sending.', 'Do not stack extra pitches onto one clear response.'],
      },
      {
        title: 'After you send it',
        copy: 'Let the conversation breathe. If the customer replies, search the new situation instead of forcing the old one forward.',
      },
    ],
    searchPrompts: [
      { label: 'Someone asked my price', query: 'someone asked my price' },
      { label: 'They stopped replying', query: 'stopped replying follow up' },
      { label: 'They said it is expensive', query: 'they said expensive' },
    ],
  },
  'dm-conversation-map': {
    eyebrow: 'CONVERSATION MAP',
    intro: 'A DM does not need to jump from interest to payment. Use the stage that matches the conversation in front of you.',
    sections: [
      {
        title: '1. Start',
        copy: 'Open the conversation with relevance. Respond to an inquiry, a story, a referral, or a clear signal of interest.',
      },
      {
        title: '2. Clarify',
        copy: 'Understand what they want, what is getting in the way, and whether your offer is the right fit before explaining everything.',
      },
      {
        title: '3. Present',
        copy: 'Connect your offer to the need they have already named. Keep the explanation focused and invite the next useful question.',
      },
      {
        title: '4. Handle',
        copy: 'Treat objections as information. Search the exact objection, use a grounded response, and keep the decision moving without pressure.',
      },
      {
        title: '5. Follow up',
        copy: 'Follow up with context or value. Do not send a vague “just checking in” when a more helpful next move exists.',
      },
    ],
    searchPrompts: [
      { label: 'Browse Start scripts', query: 'interested start conversation' },
      { label: 'Handle an objection', query: 'objection expensive discount' },
      { label: 'Find a follow-up', query: 'follow up after price' },
    ],
  },
  'objection-handling-cheat-sheet': {
    eyebrow: 'OBJECTION CHEAT SHEET',
    intro: 'An objection is not a cue to argue. Use it to find the concern underneath, then search the matching response.',
    sections: [
      {
        title: '“It is too expensive”',
        copy: 'Slow down before defending the price. Search for the price or value concern, then respond to the hesitation behind the words.',
      },
      {
        title: '“Can you give me a discount?”',
        copy: 'Do not reduce price automatically. Search the discount moment and keep the conversation centred on fit, value, and the right next step.',
      },
      {
        title: '“I need to think about it”',
        copy: 'Make room for a decision while keeping the door open. Search the exact concern or use a follow-up after they have had space.',
      },
      {
        title: '“I need to ask someone”',
        copy: 'Respect the other decision-maker. Clarify what they need to share and use a response that keeps the conversation useful, not urgent.',
      },
    ],
    searchPrompts: [
      { label: 'Price objection', query: 'it is too expensive' },
      { label: 'Discount request', query: 'can you give me a discount' },
      { label: 'Think about it', query: 'i will think about it' },
    ],
  },
  'what-do-i-say-decision-guide': {
    eyebrow: 'DECISION GUIDE',
    intro: 'When you are unsure what to say, do not write more. Use this short decision path to choose the next useful response.',
    sections: [
      {
        title: 'If they asked a direct question',
        copy: 'Search their words first. A direct question usually needs a clear answer before it needs a longer pitch.',
      },
      {
        title: 'If they shared a concern',
        copy: 'Search the concern, not your preferred answer. Match the response to the hesitation that is actually present.',
      },
      {
        title: 'If they went quiet',
        copy: 'Search the last thing that happened: after price, after information, after a call, or after a positive signal.',
      },
      {
        title: 'If they are ready',
        copy: 'Use a close that makes the next action obvious. Do not restart the whole sales conversation once the customer has shown readiness.',
      },
    ],
    searchPrompts: [
      { label: 'Asked about price', query: 'how much price' },
      { label: 'No reply yet', query: 'first follow up' },
      { label: 'Ready to buy', query: 'ready to buy close' },
    ],
  },
};

export const getResourceGuide = (slug: string) => guides[slug] || null;
