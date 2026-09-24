import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ProjectCollectionClickProps } from '../src/analytics/events/workspace.js';

describe('project collection sort telemetry contract', () => {
  it('accepts recently viewed and all existing sort values without widening to arbitrary strings', () => {
    type SortValue = NonNullable<ProjectCollectionClickProps['sort_value']>;
    expectTypeOf<SortValue>().toEqualTypeOf<'recent_viewed' | 'updated_desc' | 'updated_asc' | 'name_asc'>();
    const props: ProjectCollectionClickProps = {
      page_name: 'home', area: 'project_collection', element: 'sort', sort_value: 'recent_viewed',
    };
    expect(props.sort_value).toBe('recent_viewed');
  });
});
