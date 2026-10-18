import BaseEnvironment from '@jest/environment-jsdom-abstract';
import * as jsdom from 'jsdom';

// Jest's stock environment pins jsdom 26. The official base accepts newer jsdom versions.
export default class JsdomEnvironment extends BaseEnvironment {
  constructor(config, context) {
    super(config, context, jsdom);
  }
}
