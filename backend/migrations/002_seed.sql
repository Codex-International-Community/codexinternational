INSERT INTO users (id, provider, provider_id, email, display_name, initials, tone, status, role)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'mock', 'mika',  'mika@codex.dev',  'Mika Tanaka',   'MT', 'rose',   'online', 'OWNER'),
  ('22222222-2222-2222-2222-222222222222', 'mock', 'arlo',  'arlo@codex.dev',  'Arlo Bennett',  'AB', 'blue',   'online', 'MOD'),
  ('33333333-3333-3333-3333-333333333333', 'mock', 'sofia', 'sofia@codex.dev', 'Sofia Chen',    'SC', 'amber',  'online', NULL),
  ('44444444-4444-4444-4444-444444444444', 'mock', 'noah',  'noah@codex.dev',  'Noah Williams', 'NW', 'green',  'online', NULL),
  ('55555555-5555-5555-5555-555555555555', 'mock', 'kai',   'kai@codex.dev',   'Kai Morgan',    'KM', 'violet', 'idle',   NULL),
  ('66666666-6666-6666-6666-666666666666', 'mock', 'elena', 'elena@codex.dev', 'Elena Park',    'EP', 'pink',   'idle',   NULL)
ON CONFLICT DO NOTHING;

INSERT INTO servers (id, name, abbr, tone, owner_id) VALUES
  ('studio', 'The Studio',    'TS', 'lavender', '11111111-1111-1111-1111-111111111111'),
  ('gaming', 'After Hours',   'AH', 'blue',     '11111111-1111-1111-1111-111111111111'),
  ('design', 'Design Club',   'DC', 'orange',   '11111111-1111-1111-1111-111111111111'),
  ('dev',    'Build Space',   'BS', 'green',    '11111111-1111-1111-1111-111111111111')
ON CONFLICT DO NOTHING;

INSERT INTO channels (id, server_id, name, type, position) VALUES
  ('studio:welcome',       'studio', 'welcome',       'text', 0),
  ('studio:announcements', 'studio', 'announcements', 'text', 1),
  ('studio:general',       'studio', 'general',       'text', 2),
  ('studio:introductions', 'studio', 'introductions', 'text', 3),
  ('studio:showcase',      'studio', 'showcase',      'text', 4),
  ('studio:resources',     'studio', 'resources',     'text', 5),
  ('studio:lounge',        'studio', 'The Lounge',    'voice', 6),
  ('studio:study',         'studio', 'Study Room',    'voice', 7),
  ('gaming:general',       'gaming', 'general',       'text', 0),
  ('gaming:looking',       'gaming', 'looking-for-group', 'text', 1),
  ('gaming:voice',         'gaming', 'Squad Room',    'voice', 2),
  ('design:general',       'design', 'general',       'text', 0),
  ('design:feedback',      'design', 'feedback',      'text', 1),
  ('dev:general',          'dev',    'general',       'text', 0),
  ('dev:help',             'dev',    'help',          'text', 1)
ON CONFLICT DO NOTHING;

INSERT INTO messages (channel_id, author_id, text, reactions, created_at) VALUES
  ('studio:general', '11111111-1111-1111-1111-111111111111', 'Morning everyone! I pushed the first pass of the workspace layout.', '{"✨":["22222222-2222-2222-2222-222222222222"]}'::jsonb, now() - interval '50 minutes'),
  ('studio:general', '22222222-2222-2222-2222-222222222222', 'The channel grouping feels much clearer now.', '{"👍":["11111111-1111-1111-1111-111111111111"]}'::jsonb, now() - interval '47 minutes');