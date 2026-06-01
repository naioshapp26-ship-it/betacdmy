import DOMPurify from 'dompurify';
import { marked } from 'marked';

marked.setOptions({
  breaks: true,
  gfm: true
});

export const renderMarkdown = (content?: string) => {
  if (!content || !content.trim()) {
    return '';
  }
  const html = marked.parse(content);
  return DOMPurify.sanitize(html);
};
