ALTER TABLE usage_events
ADD COLUMN input_tokens BIGINT,
ADD COLUMN cached_input_tokens BIGINT,
ADD COLUMN output_tokens BIGINT,
ADD COLUMN reasoning_tokens BIGINT,
ADD COLUMN cost_micro_units BIGINT NOT NULL DEFAULT 0;

ALTER TABLE usage_events
ADD CONSTRAINT usage_events_input_tokens_check
CHECK (input_tokens IS NULL OR input_tokens >= 0);

ALTER TABLE usage_events
ADD CONSTRAINT usage_events_cached_input_tokens_check
CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0);

ALTER TABLE usage_events
ADD CONSTRAINT usage_events_output_tokens_check
CHECK (output_tokens IS NULL OR output_tokens >= 0);

ALTER TABLE usage_events
ADD CONSTRAINT usage_events_reasoning_tokens_check
CHECK (reasoning_tokens IS NULL OR reasoning_tokens >= 0);

ALTER TABLE usage_events
ADD CONSTRAINT usage_events_cost_micro_units_check
CHECK (cost_micro_units >= 0);