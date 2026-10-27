// Original synthetic data only. No Talk database, accounts or real transcripts.
import { transcriptContentHash } from '../../../backend/src/transcript-revisions.mjs';

const variants = {
  en: [
    ['Asha', 'Asha: I completed the login test suite.'],
    ['Ravi', 'Ravi: The dashboard is still in progress.'],
    ['Ravi', 'Ravi: The missing API documentation is blocking the dashboard.'],
    ['Manager', 'Manager: We decided to keep the release pending until the tests pass. The release is not approved.'],
    ['Manager', 'Manager: Asha will review the error logs by Friday.'],
    [null, 'Someone needs to investigate the payment timeout. No task owner or deadline has been assigned.'],
    ['Manager', 'Manager: We will revisit the blockers at the next meeting. No calendar date was specified.'],
  ],
  hi: [
    ['आशा', 'आशा: मैंने लॉगिन की टेस्ट सूट पूरी कर ली है।'],
    ['रवि', 'रवि: डैशबोर्ड का काम अभी जारी है।'],
    ['रवि', 'रवि: API दस्तावेज़ नहीं मिलने से डैशबोर्ड का काम रुका है।'],
    ['प्रबंधक', 'प्रबंधक: हमने तय किया कि टेस्ट पास होने तक रिलीज़ लंबित रहेगी। रिलीज़ को मंज़ूरी नहीं मिली है।'],
    ['प्रबंधक', 'प्रबंधक: आशा शुक्रवार तक एरर लॉग की समीक्षा करेगी।'],
    [null, 'पेमेंट टाइमआउट की जाँच करनी है। अभी किसी को ज़िम्मेदारी या समय सीमा नहीं दी गई है।'],
    ['प्रबंधक', 'प्रबंधक: अगली बैठक में रुकावटों की फिर समीक्षा करेंगे। कोई तारीख तय नहीं हुई है।'],
  ],
  hinglish: [
    ['Asha', 'Asha: Login test suite complete ho gayi hai.'],
    ['Ravi', 'Ravi: Dashboard ka kaam abhi in progress hai.'],
    ['Ravi', 'Ravi: API documentation missing hai, isliye dashboard blocked hai.'],
    ['Manager', 'Manager: Decision hai tests pass hone tak release pending rahegi. Release approve nahi hui.'],
    ['Manager', 'Manager: Asha Friday tak error logs review karegi.'],
    [null, 'Payment timeout investigate karna hai. Abhi owner assign nahi hua aur deadline bhi nahi hai.'],
    ['Manager', 'Manager: Next meeting mein blockers phir review karenge. Koi date decide nahi hui.'],
  ],
};

export const benchmarkLanguages = Object.freeze(Object.keys(variants));

export function benchmarkFixture(language) {
  if (!Object.hasOwn(variants, language)) throw new Error('Unsupported synthetic benchmark language.');
  const source = {
    id: `synthetic-revision-${language}-1`, recordingId: `synthetic-recording-${language}`,
    revision: 1, language: language === 'hinglish' ? 'hi-en' : language,
    segments: variants[language].map(([speaker, text], index) => ({
      segmentId: String(index), startMs: index * 10000, endMs: index * 10000 + 9000,
      speaker, text, language: language === 'hinglish' ? 'hi-en' : language,
    })),
  };
  source.contentHash = transcriptContentHash(source);
  return {
    name: `daily-status-${language}`, synthetic: true, sources: [source],
    expected: {
      owner: language === 'hi' ? 'आशा' : 'Asha', deadline: language === 'hi' ? 'शुक्रवार' : 'Friday',
      coverage: [
        { section: 'completedWork', segmentId: '0', fact: 'Login test suite completed.' },
        { section: 'workInProgress', segmentId: '1', fact: 'Dashboard still in progress.' },
        { section: 'blockers', segmentId: '2', fact: 'Missing API documentation blocks dashboard.' },
        { section: 'decisions', segmentId: '3', fact: 'Release remains pending until tests pass; not approved.' },
        { section: 'actionItems', segmentId: '4', fact: 'Asha reviews error logs by Friday; preserve literal name and relative deadline.' },
        { section: 'actionItems', segmentId: '5', fact: 'Investigate payment timeout; speaker, owner and deadline are unknown.' },
        { section: 'followUpNotes', segmentId: '6', fact: 'Revisit blockers next meeting; no invented calendar date.' },
      ],
      manualChecks: [
        'Summary accurately distinguishes completed work from pending work.',
        'Release NOT approved: preserve negation and conditional decision.',
        'Mentioned task owner does not become the speaker of the manager segment.',
        'Unidentified speaker stays null; payment investigation owner/deadline stay null.',
        'Do not normalize Friday or next meeting into a fabricated calendar date.',
        'No unsupported people, status, risks, decisions or follow-up commitments.',
        'Assess language quality, omissions and semantic entailment against every exact quote.',
      ],
    },
  };
}
