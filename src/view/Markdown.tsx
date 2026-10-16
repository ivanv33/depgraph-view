import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { resolveRelative } from './files.js'

export interface MarkdownProps {
  markdown: string
  /** The step whose folder relative links and images resolve against. */
  nodeId: string
}

const isHttp = (href: string) => /^https?:\/\//i.test(href)

// No rehype-raw: raw HTML in the source is dropped, and react-markdown's default urlTransform strips javascript: urls.
// An image is drawn only when it is a file in the step's folder, served through /files; any other image (a remote url
// would be fetched on render) shows as its alt text.
export default function Markdown({ markdown, nodeId }: MarkdownProps) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          img: ({ src, alt }) => {
            const url = typeof src === 'string' ? resolveRelative(nodeId, src) : null
            if (url) return <img src={url} alt={alt ?? ''} />
            return alt ? <span>{alt}</span> : null
          },
          a: ({ href, children }) => {
            const url = href ? resolveRelative(nodeId, href) : null
            if (url || (href && isHttp(href))) {
              return (
                <a href={url ?? href} target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              )
            }
            return <a href={href}>{children}</a>
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}
