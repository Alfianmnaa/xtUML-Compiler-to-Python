# __xtuml_lextab.py. This file automatically created by PLY (version 3.11). Don't edit!
_tabversion   = '3.10'
_lextokens    = set(('CARDINALITY', 'COMMA', 'CREATE', 'FALSE', 'FRACTION', 'FROM', 'GUID', 'ID', 'INDEX', 'INSERT', 'INTO', 'LPAREN', 'MINUS', 'NUMBER', 'ON', 'PHRASE', 'REF_ID', 'RELID', 'ROP', 'RPAREN', 'SEMICOLON', 'STRING', 'TABLE', 'TO', 'TRUE', 'UNIQUE', 'VALUES'))
_lexreflags   = 64
_lexliterals  = ''
_lexstateinfo = {'INITIAL': 'inclusive'}
_lexstatere   = {'INITIAL': [('(?P<t_comment>\\-\\-([^\\n]*\\n?))|(?P<t_COMMA>,)|(?P<t_FRACTION>(\\d+)(\\.\\d+))|(?P<t_RELID>R[0-9]+)|(?P<t_CARDINALITY>(1C))|(?P<t_ID>[A-Za-z_][\\w_]*)|(?P<t_LPAREN>\\()|(?P<t_MINUS>-)|(?P<t_NUMBER>[0-9]+)|(?P<t_RPAREN>\\))|(?P<t_SEMICOLON>;)|(?P<t_STRING>\\\'((\\\'\\\')|[^\\\'])*\\\')|(?P<t_GUID>\\"([^\\\\\\n]|(\\\\.))*?\\")|(?P<t_newline>\\n+)', [None, ('t_comment', 'comment'), None, ('t_COMMA', 'COMMA'), ('t_FRACTION', 'FRACTION'), None, None, ('t_RELID', 'RELID'), ('t_CARDINALITY', 'CARDINALITY'), None, ('t_ID', 'ID'), ('t_LPAREN', 'LPAREN'), ('t_MINUS', 'MINUS'), ('t_NUMBER', 'NUMBER'), ('t_RPAREN', 'RPAREN'), ('t_SEMICOLON', 'SEMICOLON'), ('t_STRING', 'STRING'), None, None, ('t_GUID', 'GUID'), None, None, ('t_newline', 'newline')])]}
_lexstateignore = {'INITIAL': ' \t\r\x0c'}
_lexstateerrorf = {'INITIAL': 't_error'}
_lexstateeoff = {}
