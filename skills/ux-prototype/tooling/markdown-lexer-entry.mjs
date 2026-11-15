import { Lexer } from 'marked';

export const markdownLexer = source => Lexer.lex(source);
