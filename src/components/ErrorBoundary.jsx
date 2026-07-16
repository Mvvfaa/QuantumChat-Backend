import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="auth-page">
          <div className="auth-card">
            <h1>Something went wrong</h1>
            <p className="auth-subtitle">{this.state.error.message}</p>
            <button type="button" onClick={() => window.location.assign('/login')}>
              Back to login
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
