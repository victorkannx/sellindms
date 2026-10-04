import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateAiReply,
  validateAiReplyOutput,
  type AiReplyBusinessContext,
  type AiReplyOffer,
  type AiReplyPromptInput,
  type AiReplyScript,
} from './ai-reply.js';

const businessContext: AiReplyBusinessContext = {
  id: 'business-1',
  businessName: 'Luma Career Coaching',
  description: 'One-to-one career coaching for mid-career professionals.',
  targetCustomer: 'Professionals preparing for a career change.',
  differentiator: 'Practical weekly coaching and interview preparation.',
  businessInformation: 'Coaching is delivered live online over four weekly sessions.',
  policies: 'No guarantees or testimonials are available in the saved business information.',
};

const activeOffer: AiReplyOffer = {
  id: 'offer-1',
  name: 'Career Clarity Coaching',
  description: 'A four-session live online coaching package.',
  price: 12_500,
  currency: 'NGN',
  includedItems: 'Four live online coaching sessions and interview preparation.',
  benefits: 'A practical career-change plan and interview preparation.',
  deliveryInformation: 'Delivered live online over four weekly sessions.',
  terms: 'To purchase, reply “ready” and we will send the payment link.',
  policies: 'Refunds are available within 7 days of purchase if coaching has not started.',
};

const scripts: AiReplyScript[] = [
  { id: 's10', scriptCode: 'SDM-010', title: 'The “How Much?” Opener', situation: 'A customer asks for the price.', theySaid: 'How much is it?', betterReply: 'Answer the price clearly, then invite the appropriate next question.', whyItWorks: 'It answers the direct question without pressure.', alternativeResponse: null, nextMove: 'Clarify the package if needed.', useThisWhen: 'A customer asks for price.', category: 'Pricing', stage: 'Interest' },
  { id: 's50', scriptCode: 'SDM-050', title: 'It’s Too Expensive', situation: 'A customer feels the price is high.', theySaid: 'That is too expensive.', betterReply: 'Understand the concern and clarify relevant value without discounting automatically.', whyItWorks: 'It respects the objection.', alternativeResponse: null, nextMove: 'Learn what makes the price feel high.', useThisWhen: 'A customer says the price is expensive.', category: 'Objections', stage: 'Consideration' },
  { id: 's52', scriptCode: 'SDM-052', title: 'Can You Give Me a Discount?', situation: 'A customer asks to reduce the price.', theySaid: 'Can you reduce the price?', betterReply: 'Do not promise an unsupplied discount.', whyItWorks: 'It protects the actual offer.', alternativeResponse: null, nextMove: 'Clarify whether the existing offer fits.', useThisWhen: 'A customer asks for a discount.', category: 'Objections', stage: 'Consideration' },
  { id: 's71', scriptCode: 'SDM-071', title: 'The First Follow-Up', situation: 'A customer stopped replying.', theySaid: null, betterReply: 'Send a calm relevant follow-up.', whyItWorks: 'It reopens the conversation without pressure.', alternativeResponse: null, nextMove: 'Give the customer room to respond.', useThisWhen: 'A customer went quiet.', category: 'Follow-up', stage: 'Follow-up' },
  { id: 's62', scriptCode: 'SDM-062', title: 'I Need to Ask My Partner', situation: 'A customer needs to consult a partner.', theySaid: 'I need to ask my husband first.', betterReply: 'Respect the decision process.', whyItWorks: 'It avoids pressure.', alternativeResponse: null, nextMove: 'Offer helpful information for the conversation.', useThisWhen: 'A customer needs to ask a partner.', category: 'Objections', stage: 'Consideration' },
];

const inputFor = (customerMessage: string, overrides: Partial<AiReplyPromptInput> = {}): AiReplyPromptInput => ({
  customerMessage,
  conversationContext: 'The customer has asked about career coaching and has received the package summary.',
  mode: 'full',
  businessContext,
  activeOffer,
  scripts,
  ...overrides,
});

const assertStructuredResult = (result: Awaited<ReturnType<typeof generateAiReply>>) => {
  assert.ok(result.reply.length > 0, 'reply must be non-empty');
  assert.ok(result.whyThisWorks.length > 0, 'why_this_works must be non-empty');
  assert.ok(result.nextMove.length > 0, 'next_move must be non-empty');
  assert.ok(result.recommendedScriptCode === null || scripts.some((script) => script.scriptCode === result.recommendedScriptCode), 'recommended script must be one of the retrieved scripts');
};

test('How much is it? uses the saved price and a retrieved pricing framework', async () => {
  const result = await generateAiReply(inputFor('How much is it?'));
  assertStructuredResult(result);
  assert.match(result.reply, /12[,.\s]?500|twelve thousand five hundred/i);
});

test('How much is it? without a saved price does not invent one', async () => {
  const result = await generateAiReply(inputFor('How much is it?', { activeOffer: { ...activeOffer, price: null, currency: null } }));
  assertStructuredResult(result);
  assert.doesNotMatch(result.reply, /12[,.\s]?500|₦|NGN/i);
});

test('That is too expensive avoids an automatic discount', async () => {
  const result = await generateAiReply(inputFor('That’s too expensive.'));
  assertStructuredResult(result);
  assert.doesNotMatch(result.reply, /\b(?:offer|give|apply|include)\b[^.]{0,35}\b(?:discount|reduction)\b|\b(?:discount|reduction)\b[^.]{0,45}\b(?:for you|on this|today)\b/i);
});

test('Can you reduce the price? never invents a discount', async () => {
  const result = await generateAiReply(inputFor('Can you reduce the price?'));
  assertStructuredResult(result);
  assert.doesNotMatch(result.reply, /\b(?:offer|give|apply|include)\b[^.]{0,35}\b(?:discount|reduction)\b|\b(?:discount|reduction)\b[^.]{0,45}\b(?:for you|on this|today)\b/i);
});

test('Send me more information returns a concise context-based reply', async () => {
  const result = await generateAiReply(inputFor('Send me more information.'));
  assertStructuredResult(result);
  assert.match(result.reply, /coaching|session|online|career/i);
});

test('A stopped conversation receives re-engagement guidance', async () => {
  const result = await generateAiReply(inputFor('They stopped replying after I sent the package details.'));
  assertStructuredResult(result);
  assert.match(`${result.reply} ${result.nextMove}`, /follow|check|reply|message/i);
});

test('I need to ask my husband first respects the decision process', async () => {
  const result = await generateAiReply(inputFor('I need to ask my husband first.'));
  assertStructuredResult(result);
  assert.match(result.reply, /fine|checking|share|forward|decide|him|her|they/i);
});

test('Someone else is cheaper does not attack competitors', async () => {
  const result = await generateAiReply(inputFor('Someone else is cheaper.'));
  assertStructuredResult(result);
  assert.doesNotMatch(result.reply, /competitor(?:s)?\s+(?:are|is)\s+(?:bad|worse|inferior)|they(?:'re| are)\s+(?:bad|worse|inferior)/i);
});

test('Okay, I want it uses the saved purchase step', async () => {
  const result = await generateAiReply(inputFor('Okay, I want it.'));
  assertStructuredResult(result);
  assert.match(result.reply, /ready|payment link/i);
});

test('Do you deliver? uses only the supplied delivery information', async () => {
  const result = await generateAiReply(inputFor('Do you deliver?'));
  assertStructuredResult(result);
  assert.match(result.reply, /live|online|weekly/i);
});

test('Do you offer refunds? uses the supplied refund policy', async () => {
  const result = await generateAiReply(inputFor('Do you offer refunds?'));
  assertStructuredResult(result);
  assert.match(result.reply, /refund|7 days|seven days/i);
});

test('unknown recommended script codes are discarded instead of fabricated', () => {
  const result = validateAiReplyOutput(JSON.stringify({
    reply: 'Thanks for asking. I do not have that detail in the saved information.',
    why_this_works: 'It answers honestly without inventing a fact.',
    next_move: 'Wait for the customer’s response before adding more information.',
    recommended_script_code: 'NOT-A-REAL-SCRIPT',
  }), scripts);
  assert.equal(result.recommendedScriptCode, null);
});
