import test from 'node:test';
import assert from 'node:assert/strict';
import { keyboardVisible } from '../public/viewport.js';
test('keyboard requires an editable focus and a substantial viewport reduction',()=>{
 assert.equal(keyboardVisible(800,480,true),true);
 assert.equal(keyboardVisible(800,480,false),false);
 assert.equal(keyboardVisible(800,740,true),false);
 assert.equal(keyboardVisible(800,800,true),false);
 assert.equal(keyboardVisible(800,900,true),false);
});
