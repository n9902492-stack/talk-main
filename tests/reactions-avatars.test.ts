import test from 'node:test';
import assert from 'node:assert/strict';
import { findReactions, reactionCategories, recentReactions, reactionChoices } from '../frontend/src/lib/reactionCatalog';
import { avatarInitials, staticAvatarCapabilities } from '../frontend/src/lib/avatars';
test('emoji search, all five categories and recents are bounded and allowlisted',()=>{
  assert.equal(findReactions().length,24);assert.equal(reactionCategories.length,5);
  for(const category of reactionCategories)assert.ok(findReactions('',category).length);
  assert.equal(findReactions(' THANKS ')[0].emoji,'🙏');assert.equal(findReactions('🚀')[0].label,'Rocket');assert.deepEqual(findReactions('notfound'),[]);
  assert.deepEqual(recentReactions(['invalid','👍','👍','❤️']),['👍','❤️']);assert.equal(recentReactions(reactionChoices).length,8);assert.deepEqual(recentReactions({}),[]);
});
test('initials support Unicode and static renderers never require camera or microphone',()=>{
  assert.equal(avatarInitials('  Jane   Doe  '),'JD');assert.equal(avatarInitials(''),'T');assert.equal(avatarInitials('Éva Clark'),'ÉC');
  assert.deepEqual(staticAvatarCapabilities,{animated:false,requiresCamera:false,requiresMicrophone:false});
});
