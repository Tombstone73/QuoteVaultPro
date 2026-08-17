-- Finance history is a distinct read authority from taking a payment/refund.
INSERT INTO v2_permission_capabilities(id,module,label)
VALUES ('payment.view','billing','View payment and refund history')
ON CONFLICT(id) DO NOTHING;

INSERT INTO v2_permission_set_template_capabilities(template_id,capability_id)
SELECT template.id,'payment.view'
FROM v2_permission_set_templates template
WHERE template.template_key IN ('owner','accounting')
ON CONFLICT DO NOTHING;
