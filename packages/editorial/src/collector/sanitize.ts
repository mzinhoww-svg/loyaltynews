/** Saneamento de conteúdo externo (ADR-007): remove HTML ativo e marca instruções embutidas como suspeitas. */

const INJECTION_PATTERNS: Array<[string, RegExp]> = [
  ['ignore_instructions', /(ignore|desconsidere|esque[çc]a)\s+(todas?\s+)?(as\s+)?(regras|instru[çc][õo]es|instructions|rules|previous)/i],
  ['ignore_instructions_en', /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|rules)/i],
  ['publish_command', /\b(publique|publicar agora|publish (this|now)|aprove (esta|a) mat[ée]ria)\b/i],
  ['role_override', /(voc[êe]\s+agora\s+[ée]|you\s+are\s+now|system\s*prompt|novo\s+papel)/i],
  ['tool_call', /(chame|execute|invoque|call|run)\s+(a\s+)?(ferramenta|tool|fun[çc][ãa]o|function|comando|command)/i],
  ['secret_request', /(revele|envie|mostre|reveal|send)\s+.{0,30}(senha|chave|token|api[\s_-]?key|secret|credencia)/i],
];

export interface Sanitized { text: string; suspicious: boolean; reasons: string[] }

export function stripHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|iframe|object|embed)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/[​-‏‪-‮⁠﻿]/g, '') // caracteres invisíveis/bidi
    .replace(/[ \t\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

export function sanitize(htmlOrText: string): Sanitized {
  const text = stripHtml(htmlOrText);
  const reasons: string[] = [];
  // Procura também no HTML bruto (instruções escondidas em comentários/atributos).
  for (const [name, re] of INJECTION_PATTERNS) if (re.test(text) || re.test(htmlOrText)) reasons.push(name);
  return { text, suspicious: reasons.length > 0, reasons };
}
