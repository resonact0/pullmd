import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatPost } from '../lib/reddit.js';

const makePostData = (overrides = {}) => ({
  title: 'Test Post Title',
  author: 'testuser',
  subreddit: 'javascript',
  score: 142,
  created_utc: Math.floor(Date.now() / 1000) - 7200,
  selftext: 'This is the post body.\n\nWith multiple paragraphs.',
  is_self: true,
  url: 'https://www.reddit.com/r/javascript/comments/abc123/test_post/',
  num_comments: 234,
  is_video: false,
  media: null,
  gallery_data: null,
  media_metadata: null,
  post_hint: undefined,
  ...overrides,
});

describe('formatPost', () => {
  it('formats a self-text post correctly', () => {
    const result = formatPost(makePostData(), 'https://www.reddit.com/r/javascript/comments/abc123/test_post/');
    assert.ok(result.startsWith('# Test Post Title\n'));
    assert.ok(result.includes('u/testuser'));
    assert.ok(result.includes('**r/javascript**'));
    assert.ok(result.includes('142 ↑'));
    assert.ok(result.includes('This is the post body.'));
    assert.ok(result.includes('With multiple paragraphs.'));
    assert.ok(result.includes('https://www.reddit.com/r/javascript/comments/abc123/test_post/'));
  });

  it('formats a link post with the URL', () => {
    const result = formatPost(makePostData({
      is_self: false,
      selftext: '',
      url: 'https://example.com/article',
      post_hint: 'link',
    }), 'https://www.reddit.com/r/javascript/comments/abc123/test_post/');
    assert.ok(result.includes('https://example.com/article'));
  });

  it('formats an image post', () => {
    const result = formatPost(makePostData({
      is_self: false,
      selftext: '',
      url: 'https://i.redd.it/example.jpg',
      post_hint: 'image',
    }), 'https://www.reddit.com/r/javascript/comments/abc123/test_post/');
    assert.ok(result.includes('![](https://i.redd.it/example.jpg)'));
  });

  it('formats a video post with fallback URL', () => {
    const result = formatPost(makePostData({
      is_self: false,
      is_video: true,
      selftext: '',
      url: 'https://v.redd.it/abc123',
      media: { reddit_video: { fallback_url: 'https://v.redd.it/abc123/DASH_720.mp4' } },
    }), 'https://www.reddit.com/r/javascript/comments/abc123/test_post/');
    assert.ok(result.includes('https://v.redd.it/abc123/DASH_720.mp4'));
  });

  it('shows relative time for recent posts', () => {
    const result = formatPost(makePostData({
      created_utc: Math.floor(Date.now() / 1000) - 7200,
    }));
    assert.ok(result.includes('2h ago'));
  });

  it('handles deleted author', () => {
    const result = formatPost(makePostData({ author: '[deleted]' }));
    assert.ok(result.includes('u/[deleted]'));
  });

  it('formats a gallery post with multiple images', () => {
    const result = formatPost(makePostData({
      is_self: false,
      selftext: '',
      url: 'https://www.reddit.com/gallery/abc123',
      gallery_data: {
        items: [
          { media_id: 'img1' },
          { media_id: 'img2' },
        ]
      },
      media_metadata: {
        img1: { s: { u: 'https://preview.redd.it/img1.jpg?width=1080&amp;format=png' } },
        img2: { s: { u: 'https://preview.redd.it/img2.jpg?width=1080&amp;format=png' } },
      },
    }));
    assert.ok(result.includes('![](https://preview.redd.it/img1.jpg?width=1080&format=png)'));
    assert.ok(result.includes('![](https://preview.redd.it/img2.jpg?width=1080&format=png)'));
  });
});
