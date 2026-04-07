// frontend/src/App.jsx
import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './App.css';

function App() {
  // Core app state
  const [healthStatus, setHealthStatus] = useState('');
  const [prompt, setPrompt] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showIndividual, setShowIndividual] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [showIndividualResponses, setShowIndividualResponses] = useState({});
  
  // Claude-style conversation management
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [conversationHistory, setConversationHistory] = useState([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  
  // Refs
  const chatContainerRef = useRef(null);
  const textareaRef = useRef(null);

  const API_BASE_URL = 'https://kosma-ai-aggregator-production.up.railway.app';

  // Detect mobile device and screen size with debouncing for smooth transitions
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  
  useEffect(() => {
    let timeoutId;
    
    const checkMobile = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      setWindowWidth(window.innerWidth);
      // Auto-collapse sidebar on mobile
      if (mobile) {
        setSidebarCollapsed(true);
      }
    };
    
    const debouncedResize = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(checkMobile, 100); // Debounce for smoother transitions
    };
    
    checkMobile();
    window.addEventListener('resize', debouncedResize);
    
    return () => {
      window.removeEventListener('resize', debouncedResize);
      clearTimeout(timeoutId);
    };
  }, []);

  // Calculate responsive sidebar margin - Claude-style granular breakpoints
  const getSidebarMargin = () => {
    // Mobile uses transform positioning, no margin needed
    if (isMobile || windowWidth <= 768) return '0px'; 
    
    if (sidebarCollapsed) {
      // Granular collapsed widths
      if (windowWidth >= 1400) return '60px';
      if (windowWidth >= 1200) return '55px';
      if (windowWidth >= 1024) return '50px';
      if (windowWidth >= 900) return '45px';
      return '40px'; // 769px - 899px
    } else {
      // Granular expanded widths
      if (windowWidth >= 1400) return '280px';
      if (windowWidth >= 1200) return '260px';
      if (windowWidth >= 1024) return '240px';
      if (windowWidth >= 900) return '220px';
      return '200px'; // 769px - 899px
    }
  };


  // Conversation management functions
  const createNewConversation = () => {
    const newConversation = {
      id: Date.now().toString(),
      title: 'New Conversation',
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    setConversations(prev => [newConversation, ...prev]);
    setCurrentConversationId(newConversation.id);
    setConversationHistory([]);
    setResults(null);
    setError('');
    setShowIndividualResponses({});
  };

  const switchConversation = (conversationId) => {
    const conversation = conversations.find(c => c.id === conversationId);
    if (conversation) {
      setCurrentConversationId(conversationId);
      setConversationHistory(conversation.messages);
      setResults(null);
      setError('');
      setShowIndividualResponses({});
    }
  };

  const updateConversationTitle = (conversationId, newTitle) => {
    setConversations(prev => 
      prev.map(conv => 
        conv.id === conversationId 
          ? { ...conv, title: newTitle, updatedAt: new Date().toISOString() }
          : conv
      )
    );
  };

  const deleteConversation = (conversationId) => {
    setConversations(prev => prev.filter(c => c.id !== conversationId));
    if (currentConversationId === conversationId) {
      if (conversations.length > 1) {
        const remainingConversations = conversations.filter(c => c.id !== conversationId);
        switchConversation(remainingConversations[0].id);
      } else {
        createNewConversation();
      }
    }
  };

  // Initialize app
  useEffect(() => {
    // Check backend health on component mount
    axios.get(`${API_BASE_URL}/api/health`)
      .then(response => {
        setHealthStatus(response.data.message);
        console.log('Backend connected successfully:', response.data);
      })
      .catch(error => {
        console.error('Error connecting to backend:', error);
        setHealthStatus('Error connecting to backend');
      });
    
    // Load conversations from localStorage on mount
    const savedConversations = localStorage.getItem('kosma-conversations');
    if (savedConversations) {
      try {
        const parsed = JSON.parse(savedConversations);
        setConversations(parsed);
        if (parsed.length > 0) {
          setCurrentConversationId(parsed[0].id);
          setConversationHistory(parsed[0].messages);
        } else {
          // Create initial conversation if saved but empty
          createNewConversation();
        }
      } catch (error) {
        console.error('Error loading conversations:', error);
        createNewConversation();
      }
    } else {
      // Create initial conversation if none exist
      createNewConversation();
    }
  }, []);

  // Save conversations to localStorage
  useEffect(() => {
    if (conversations.length > 0) {
      localStorage.setItem('kosma-conversations', JSON.stringify(conversations));
    }
  }, [conversations]);

  // Auto-resize textarea with responsive limits
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const maxHeight = isMobile ? 120 : 200;
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, maxHeight) + 'px';
    }
  }, [prompt, isMobile]);

  // Scroll to bottom when new messages appear - using window scroll
  useEffect(() => {
    if (conversationHistory.length > 0) {
      setTimeout(() => {
        window.scrollTo({
          top: document.documentElement.scrollHeight,
          behavior: 'smooth'
        });
      }, 100);
    }
  }, [conversationHistory.length]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!prompt.trim()) {
      setError('Please enter a prompt');
      return;
    }

    if (prompt.length > 2000) {
      setError('Prompt is too long. Maximum 2000 characters allowed.');
      return;
    }

    // Store prompt before clearing
    const currentPrompt = prompt.trim();
    setPrompt('');

    const userMessage = {
      type: 'user',
      content: currentPrompt,
      timestamp: new Date().toISOString()
    };

    // Ensure we have a current conversation
    let activeConversationId = currentConversationId;
    if (!activeConversationId) {
      // Create new conversation synchronously
      const newConvId = Date.now().toString();
      const newConversation = {
        id: newConvId,
        title: 'New Conversation',
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      setConversations(prev => [newConversation, ...prev]);
      setCurrentConversationId(newConvId);
      activeConversationId = newConvId;
    }

    // Add user message to conversation
    const newHistory = [...conversationHistory, userMessage];
    setConversationHistory(newHistory);
    setLoading(true);
    setError('');
    setResults(null);
    setShowIndividual(false);

    // Update conversation title from first message  
    // Note: Skip title update for now since conversations state might not be updated yet
    // The title will be updated when the conversation is saved to localStorage

    try {
      console.log('🚀 Sending request to backend...', { activeConversationId, currentPrompt });
      const response = await axios.post(`${API_BASE_URL}/api/aggregate`, {
        prompt: currentPrompt
      });

      console.log('✅ Response received:', response.data);
      
      const aiMessage = {
        type: 'ai',
        content: response.data,
        timestamp: new Date().toISOString()
      };

      const finalHistory = [...newHistory, aiMessage];
      console.log('📝 Updating conversation history:', finalHistory.length, 'messages');
      
      setConversationHistory(finalHistory);
      setResults(response.data);

      // Update conversation with new messages
      setConversations(prev => {
        const updated = prev.map(conv => 
          conv.id === activeConversationId 
            ? { 
                ...conv, 
                messages: finalHistory, 
                updatedAt: new Date().toISOString(),
                title: conv.title === 'New Conversation' 
                  ? (currentPrompt.length > 50 ? currentPrompt.substring(0, 50) + '...' : currentPrompt)
                  : conv.title
              }
            : conv
        );
        console.log('💾 Updated conversations:', updated.length);
        return updated;
      });
      
    } catch (err) {
      console.error('Error during aggregation:', err);
      const errorMessage = err.response?.data?.error || err.message || 'An unexpected error occurred';
      setError(errorMessage);
      
      // Remove user message if request failed
      setConversationHistory(prev => prev.slice(0, -1));
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Cmd/Ctrl + N for new conversation
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        createNewConversation();
      }
      
      // Cmd/Ctrl + [ or ] for sidebar toggle
      if ((e.metaKey || e.ctrlKey) && (e.key === '[' || e.key === ']')) {
        e.preventDefault();
        setSidebarCollapsed(!sidebarCollapsed);
      }

      // Escape to close sidebar on mobile
      if (e.key === 'Escape' && isMobile && !sidebarCollapsed) {
        setSidebarCollapsed(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sidebarCollapsed, isMobile]);

  const getConfidenceBadgeColor = (confidence) => {
    if (!confidence || typeof confidence !== 'string') return 'error-confidence';
    
    const confidenceLower = confidence.toLowerCase();
    if (confidenceLower.includes('high')) return 'high-confidence';
    if (confidenceLower.includes('medium') || confidenceLower.includes('multiple')) return 'medium-confidence';
    if (confidenceLower.includes('low') || confidenceLower.includes('diverse')) return 'low-confidence';
    return 'error-confidence';
  };

  const formatSynthesizedAnswer = (text) => {
    // Check if text is valid before processing
    if (!text || typeof text !== 'string') {
      return '<p>No synthesized response available.</p>';
    }
    
    // Convert markdown-style formatting to HTML with responsive considerations
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n•/g, '<br>•')
      .replace(/\n/g, '<br>')
      .replace(/^/, '<p>')
      .replace(/$/, '</p>');
  };

  const getSourceIcon = (source) => {
    const icons = {
      'OpenAI': '🤖',
      'Anthropic': '🧠', 
      'Google': '🔍'
    };
    return icons[source] || '💬';
  };

  const truncateForMobile = (text, maxLength = 100) => {
    if (!isMobile || text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  const toggleIndividualResponses = (messageIndex) => {
    setShowIndividualResponses(prev => ({
      ...prev,
      [messageIndex]: !prev[messageIndex]
    }));
  };

  const renderMessage = (message, index) => {
    if (message.type === 'user') {
      return (
        <div key={index} className="message-wrapper user">
          <div className="message-bubble">
            <div className="message-content">
              {isMobile && message.content.length > 150 
                ? message.content.substring(0, 150) + '...' 
                : message.content}
            </div>
          </div>
        </div>
      );
    } else {
      const data = message.content;
      
      // Check if synthesis data exists
      if (!data || !data.synthesis) {
        return (
          <div key={index} className="message-wrapper ai">
            <div className="message-bubble">
              <div className="synthesized-content">
                <p>Error: Invalid response format</p>
              </div>
            </div>
          </div>
        );
      }
      
      return (
        <div key={index} className="message-wrapper ai">
          <div className="message-bubble">
            <div className="synthesis-header">
              <div className="synthesis-title">
                {isMobile ? '🎯 Synthesis' : '🎯 AI Synthesis'}
              </div>
              <div className={`confidence-badge ${getConfidenceBadgeColor(data.synthesis.confidence || 'low')}`}>
                {isMobile 
                  ? `${data.synthesis.confidenceScore || 0}%` 
                  : `${data.synthesis.confidence || 'low'} (${data.synthesis.confidenceScore || 0}%)`}
              </div>
            </div>
            
            <div 
              className="synthesized-content"
              dangerouslySetInnerHTML={{ 
                __html: formatSynthesizedAnswer(data.synthesis.synthesizedAnswer || data.synthesis.response) 
              }}
            />
            
            {/* Individual AI Responses Toggle */}
            <div className="individual-ai-responses-section">
              <button 
                onClick={() => toggleIndividualResponses(index)}
                className="toggle-individual-ai-button"
              >
                {showIndividualResponses[index] ? '▲' : '▼'} {isMobile ? 'AI Responses' : 'View Individual AI Responses'}
              </button>

              {showIndividualResponses[index] && (
                <div className="individual-ai-responses">
                  <div className="individual-responses-grid">
                    {Object.entries(data.individualResponses).map(([service, response]) => (
                      <div key={service} className={`individual-ai-response ${response.error ? 'error' : ''}`}>
                        <div className="ai-service-header">
                          <span className="service-icon">{getSourceIcon(service.charAt(0).toUpperCase() + service.slice(1))}</span>
                          <span className="service-name">{service.charAt(0).toUpperCase() + service.slice(1)}</span>
                          {response.error && <span className="error-indicator">⚠️</span>}
                        </div>
                        <div className="ai-response-text">
                          {response.error ? (
                            <span className="error-text">
                              Error: {response.message}
                            </span>
                          ) : (
                            <span className="response-text">
                              {isMobile && response.length > 200 
                                ? response.substring(0, 200) + '...' 
                                : response}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            
            <div className="synthesis-meta">
              <div className="meta-row">
                <div className="sources-used">
                  <strong>Sources:</strong>
                  {data.synthesis.sourcesUsed.map(source => (
                    <span key={source} className="source-tag">
                      {getSourceIcon(source)} {isMobile ? source.substring(0, 3) : source}
                    </span>
                  ))}
                </div>
                {data.metadata && !isMobile && (
                  <div className="processing-time">
                    {data.metadata.processingTimeMs}ms
                  </div>
                )}
              </div>
              <div className="meta-row">
                <div className="reasoning">
                  {isMobile 
                    ? truncateForMobile(data.synthesis.reasoning, 80)
                    : data.synthesis.reasoning}
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }
  };

  const getPlaceholderText = () => {
    if (isMobile) {
      return "Ask anything... (Enter to send)";
    }
    return "Ask me anything... (Press Enter to send, Shift+Enter for new line)";
  };

  const getEmptyStateContent = () => {
    if (isMobile) {
      return {
        icon: '💬',
        title: 'Ask AI Anything',
        subtitle: 'Get insights from multiple AI models'
      };
    }
    return {
      icon: '💬',
      title: 'Ask anything to get synthesized insights',
      subtitle: 'I\'ll consult multiple AI models and give you a combined answer with confidence scoring.'
    };
  };

  const emptyState = getEmptyStateContent();

  return (
    <div className="claude-app">
      {/* Claude-style Sidebar */}
      <aside className={`claude-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <span className="brand-icon">⚡</span>
            {!sidebarCollapsed && <span className="brand-text">KOSMA AI</span>}
          </div>
          <button 
            className="sidebar-toggle"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!sidebarCollapsed}
          >
            {sidebarCollapsed ? '→' : '←'}
          </button>
        </div>

        <div className="sidebar-content">
          <button 
            className="new-conversation-btn"
            onClick={createNewConversation}
            aria-label="Start new conversation"
          >
            <span className="btn-icon">+</span>
            {!sidebarCollapsed && <span>New Conversation</span>}
          </button>

          {!sidebarCollapsed && (
            <div className="conversations-list">
              <div className="conversations-header">Recent</div>
              {conversations.map(conversation => (
                <div 
                  key={conversation.id}
                  className={`conversation-item ${conversation.id === currentConversationId ? 'active' : ''}`}
                  onClick={() => switchConversation(conversation.id)}
                  role="button"
                  tabIndex={0}
                  aria-label={`Switch to conversation: ${conversation.title}`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      switchConversation(conversation.id);
                    }
                  }}
                >
                  <div className="conversation-title">{conversation.title}</div>
                  <div className="conversation-date">
                    {new Date(conversation.updatedAt).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="sidebar-footer">
          <div className={`health-status ${healthStatus.includes('Error') ? 'error' : 'success'}`}>
            <span className="status-indicator" />
            {!sidebarCollapsed && (
              <span className="status-text">
                {healthStatus.includes('Error') ? 'Offline' : 'Online'}
              </span>
            )}
          </div>
        </div>
      </aside>

      {/* Claude-style Main Content */}
      <main className="claude-main"
        style={{ marginLeft: getSidebarMargin() }}
      >
        <div className="claude-chat-container">
          <div className="claude-messages" ref={chatContainerRef}>
            {conversationHistory.length === 0 && (
              <div className="claude-empty-state">
                <div className="empty-state-icon">{emptyState.icon}</div>
                <h2 className="empty-state-title">{emptyState.title}</h2>
                <p className="empty-state-subtitle">{emptyState.subtitle}</p>
              </div>
            )}

            {conversationHistory.map((message, index) => renderMessage(message, index))}

            {loading && (
              <div className="claude-loading">
                <div className="loading-dots">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
                <span className="loading-text">
                  {isMobile 
                    ? '🤔 Thinking...' 
                    : '🤔 Consulting AI models...'}
                </span>
              </div>
            )}

            {error && (
              <div className="claude-error">
                <strong>Error:</strong> {error}
              </div>
            )}
          </div>

          {/* Claude-style Input Area */}
          <div className="claude-input-container">
            <form onSubmit={handleSubmit} className="claude-input-form">
              <div className="claude-input-wrapper">
                <textarea
                  ref={textareaRef}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder={getPlaceholderText()}
                  disabled={loading}
                  maxLength={2000}
                  rows={1}
                  className="claude-textarea"
                />
                <div className="claude-input-footer">
                  <div className="character-count">
                    {`${prompt.length}/2000`}
                  </div>
                  <button 
                    type="submit" 
                    disabled={loading || !prompt.trim()}
                    className={`claude-submit-btn${prompt.trim() ? ' has-content' : ''}`}
                    title="Send message"
                  >
                    {loading ? (
                      <div className="loading-spinner"></div>
                    ) : (
                      '→'
                    )}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </main>

      {/* Mobile overlay for sidebar */}
      {!sidebarCollapsed && isMobile && (
        <div 
          className="sidebar-overlay"
          onClick={() => setSidebarCollapsed(true)}
        />
      )}
    </div>
  );
}

export default App;
