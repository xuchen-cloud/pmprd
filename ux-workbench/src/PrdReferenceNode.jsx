import React, { useContext } from 'react';
import { Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { PrdReferenceBlock, PrdReferenceContext } from './PrdReference.jsx';
import { annotationReferenceMarkdown } from './prd-references.mjs';

function ReferenceNodeView({ node, editor, getPos, deleteNode }) {
  const context = useContext(PrdReferenceContext), position = getPos();
  let occurrence = 0;
  editor.state.doc.descendants((candidate, offset) => {
    if (offset > position) return false;
    if (candidate.type.name === 'annotationReference' && candidate.attrs.annotationId === node.attrs.annotationId) occurrence++;
    return true;
  });
  const referenceId = `${node.attrs.annotationId}:${occurrence || 1}`;
  return <NodeViewWrapper className="uxw-prd-reference-node" contentEditable={false}>
    <PrdReferenceBlock annotationId={node.attrs.annotationId} referenceId={referenceId} annotations={context.annotations}
      onLocateAnnotation={context.onLocateAnnotation} selected={context.selectedReferenceId === referenceId}
      onRemove={context.readOnly ? undefined : deleteNode} />
  </NodeViewWrapper>;
}

export const PrdAnnotationReference = Node.create({
  name: 'annotationReference', group: 'block', atom: true, selectable: true, draggable: false,
  addAttributes: () => ({ annotationId: { default: '' } }),
  parseHTML: () => [{ tag: 'div[data-prd-annotation-reference]', getAttrs: element => /^ann-[A-Za-z0-9_-]+$/.test(element.getAttribute('data-prd-annotation-reference') || '') ? ({ annotationId: element.getAttribute('data-prd-annotation-reference') }) : false }],
  renderHTML: ({ node }) => ['div', { 'data-prd-annotation-reference': node.attrs.annotationId }, annotationReferenceMarkdown(node.attrs.annotationId)],
  renderMarkdown: node => annotationReferenceMarkdown(node.attrs.annotationId),
  addNodeView: () => ReactNodeViewRenderer(ReferenceNodeView, { stopEvent: ({ event }) => !!event.target.closest('button,summary,details,a,input') }),
});
