/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const expect = require('expect');
 
const { bashShellQuote, winShellQuote, bashShellParse, winShellParse } = require('../../out/shell');

describe('bash', () => {
  describe('shellParse', () => {
    it('parses basic command lines.', () => {
      expect(bashShellParse('')).toStrictEqual([]);
      expect(bashShellParse('   \t  ')).toStrictEqual([]);
      expect(bashShellParse('hello there world')).toStrictEqual(['hello', 'there', 'world']);
      expect(bashShellParse('   /foo/bar  \t /bar/baz\t/biz   ')).toStrictEqual(['/foo/bar', '/bar/baz', '/biz']);
    });

    it('handles double quotes.', () => {
      expect(bashShellParse('"basic arg" "and another"')).toStrictEqual(['basic arg', 'and another']);
      expect(bashShellParse('"weird "arg an"d a"nother an"d again"')).toStrictEqual(['weird arg', 'and another', 'and again']);
      expect(bashShellParse('"can \\" embed quotes \' like this"')).toStrictEqual(['can " embed quotes \' like this']);
    });

    it('handles single quotes.', () => {
      expect(bashShellParse('\'basic arg\' \'and another\'')).toStrictEqual(['basic arg', 'and another']);
      expect(bashShellParse('\'weird \'arg an\'d a\'nother an\'d again\'')).toStrictEqual(['weird arg', 'and another', 'and again']);
      expect(bashShellParse('\'can " embed quotes like this\'')).toStrictEqual(['can " embed quotes like this']);
      expect(bashShellParse('\'cannot embed \\\'single quotes')).toStrictEqual(['cannot embed \\single', 'quotes']);
    });

    it('handles continuations', () => {
      expect(bashShellParse('a long \\\n command line')).toStrictEqual(['a', 'long', 'command', 'line']);
      expect(bashShellParse('a long\\\ncommand line')).toStrictEqual(['a', 'longcommand', 'line']);
      expect(bashShellParse('works "in \\\n quotes"')).toStrictEqual(['works', 'in  quotes']);
      expect(bashShellParse('works "in\\\nquotes"')).toStrictEqual(['works', 'inquotes']);
      expect(bashShellParse('not \'in\\\nsingle quotes\'')).toStrictEqual(['not', 'in\\\nsingle quotes']);
    });

    it('handles braces', () => {
      expect(bashShellParse('foo test\\(\\)')).toStrictEqual(['foo', 'test()']);
      expect(bashShellParse('foo \'test()\'')).toStrictEqual(['foo', 'test()']);
      expect(bashShellParse('foo "test()"')).toStrictEqual(['foo', 'test()']);
    });
  });

  describe('shellQuote', () => {
    let check = (args, expected) => {
      let result = bashShellQuote(args);
      expect(result).toStrictEqual(expected);
      expect(bashShellParse(result)).toStrictEqual(args);
    };

    it('quotes basic arguments', () => {
      check(['foo', 'bar', 'baz'], 'foo bar baz');
      check(['/foofoo', '/bar', 'baz'], '/foofoo /bar baz');
    });

    it('quotes spaced arguments', () => {
      check(['foo', 'bar biz', 'baz'], 'foo \'bar biz\' baz');
      check(['foo', ' bar biz', 'baz'], 'foo \' bar biz\' baz');
      check(['foo', 'bar biz ', 'baz'], 'foo \'bar biz \' baz');
    });

    it('quotes double quotes', () => {
      check(['double', '"test"'], 'double \'"test"\'');
      check(['double', 't"e"st"'], 'double \'t"e"st"\'');
    });

    it('quotes single quotes', () => {
      check(['single', '\'test\''], 'single "\'test\'"');
      check(['single', 't\'e\'st\''], 'single "t\'e\'st\'"');
    });

    it('quotes escapes', () => {
      check(['escape', 'foo\\ba\\r'], 'escape \'foo\\ba\\r\'');
    });

    it('handles complex cases', () => {
      check(['complex', 'foo"bar\'baz bopdiz daz\\oh'], 'complex "foo\\"bar\'baz bopdiz daz\\\\oh"');
    });

    it('quotes braces', () => {
      check(['test', 'foo()'], 'test \'foo()\'');
    });
  });
});

describe('windows', () => {
  describe('shellParse', () => {
    it('parses basic command lines.', () => {
      expect(winShellParse('')).toStrictEqual([]);
      expect(winShellParse('   \t  ')).toStrictEqual([]);
      expect(winShellParse('hello there world')).toStrictEqual(['hello', 'there', 'world']);
      expect(winShellParse('   /foo/bar  \t /bar/baz\t/biz   ')).toStrictEqual(['/foo/bar', '/bar/baz', '/biz']);
    });

    it('handles double quotes.', () => {
      expect(winShellParse('"basic arg" "and another"')).toStrictEqual(['basic arg', 'and another']);
      expect(winShellParse('"weird "arg an"d a"nother an"d again"')).toStrictEqual(['weird arg', 'and another', 'and again']);
      expect(winShellParse('"can \\" embed quotes \' like this"')).toStrictEqual(['can " embed quotes \' like this']);
      expect(winShellParse('\\"isn\'t counted.')).toStrictEqual(['"isn\'t', 'counted.']);
    });

    it('handles escapes correctly.', () => {
      expect(winShellParse('Show\\\\\\\\the result')).toStrictEqual(['Show\\\\\\\\the', 'result']);
      expect(winShellParse('Show\\\\\\the result')).toStrictEqual(['Show\\\\\\the', 'result']);
      expect(winShellParse('Show\\\\\\"the result')).toStrictEqual(['Show\\"the', 'result']);
      expect(winShellParse('Show\\\\\\\\"the result"')).toStrictEqual(['Show\\\\the result']);
      expect(winShellParse('Show \\\\\\\\ the result"')).toStrictEqual(['Show', '\\\\\\\\', 'the', 'result']);
    });

    it('matches ms docs', () => {
      expect(winShellParse('"a b c" d e')).toStrictEqual(['a b c', 'd', 'e']);
      expect(winShellParse('"ab\\"c" "\\\\" d')).toStrictEqual(['ab"c', '\\', 'd']);
      expect(winShellParse('a\\\\\\b d"e f"g h')).toStrictEqual(['a\\\\\\b', 'de fg', 'h']);
      expect(winShellParse('a\\\\\\"b c d')).toStrictEqual(['a\\"b', 'c', 'd']);
      expect(winShellParse('a\\\\\\\\"b c" d e')).toStrictEqual(['a\\\\b c', 'd', 'e']);
    });
  });

  describe('shellQuote', () => {
    let check = (args, expected) => {
      let result = winShellQuote(args);
      expect(result).toStrictEqual(expected);
      expect(winShellParse(result)).toStrictEqual(args);
    };

    it('quotes basic arguments', () => {
      check(['foo', 'bar', 'baz'], 'foo bar baz');
      check(['/foofoo', '/bar', 'baz'], '/foofoo /bar baz');
    });

    it('quotes spaced arguments', () => {
      check(['foo', 'bar biz', 'baz'], 'foo "bar biz" baz');
      check(['foo', ' bar biz', 'baz'], 'foo " bar biz" baz');
      check(['foo', 'bar biz ', 'baz'], 'foo "bar biz " baz');
    });

    it('quotes double quotes', () => {
      check(['double', '"test"'], 'double \\"test\\"');
      check(['double', 't"e"st"'], 'double t\\"e\\"st\\"');
      check(['double', 'foo"'], 'double foo\\"');
      check(['double', 'foo\\"'], 'double foo\\\\\\"');
      check(['double', 'foo\\ \\"'], 'double "foo\\ \\\\\\""');
    });

    it('ignores single quotes', () => {
      check(['single', '\'test\''], 'single \'test\'');
      check(['single', 't\'e\'st\''], 'single t\'e\'st\'');
    });

    it('quotes escapes', () => {
      check(['escape', 'foo\\ba\\r'], 'escape foo\\ba\\r');
    });

    it('handles complex cases', () => {
      check(['complex', 'foo "test" bar\\\\baz'], 'complex "foo \\"test\\" bar\\\\baz"');
    });
  });
});
