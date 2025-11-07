import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface FeatureVote {
  id: string;
  name: string;
  description: string;
  encryptedVotes: string;
  publicValue1: number;
  publicValue2: number;
  timestamp: number;
  creator: string;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [features, setFeatures] = useState<FeatureVote[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingFeature, setCreatingFeature] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newFeatureData, setNewFeatureData] = useState({ 
    name: "", 
    description: "", 
    votes: "0" 
  });
  const [selectedFeature, setSelectedFeature] = useState<FeatureVote | null>(null);
  const [decryptedData, setDecryptedData] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [userHistory, setUserHistory] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState("");

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const featuresList: FeatureVote[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          featuresList.push({
            id: businessId,
            name: businessData.name,
            description: businessData.description,
            encryptedVotes: businessId,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setFeatures(featuresList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createFeature = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingFeature(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating feature with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const voteValue = parseInt(newFeatureData.votes) || 0;
      const businessId = `feature-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, voteValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newFeatureData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        newFeatureData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setUserHistory(prev => [{
        type: 'create',
        feature: newFeatureData.name,
        timestamp: Date.now(),
        votes: voteValue
      }, ...prev]);
      
      setTransactionStatus({ visible: true, status: "success", message: "Feature created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewFeatureData({ name: "", description: "", votes: "0" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingFeature(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryption
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setUserHistory(prev => [{
        type: 'decrypt',
        feature: businessId,
        timestamp: Date.now(),
        value: Number(clearValue)
      }, ...prev]);
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const result = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Contract is available and working!" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Contract call failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredFeatures = features.filter(feature => 
    feature.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    feature.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const stats = {
    totalFeatures: features.length,
    verifiedFeatures: features.filter(f => f.isVerified).length,
    totalVotes: features.reduce((sum, f) => sum + (f.decryptedValue || 0), 0),
    userContributions: userHistory.length
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🔐 FHE Feature Vote</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">💡</div>
            <h2>Welcome to Encrypted Feature Voting</h2>
            <p>Connect your wallet to start voting on product features with full privacy protection using FHE technology.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted voting system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>💡 FHE Feature Vote</h1>
          <p>Encrypted Product Feedback</p>
        </div>
        
        <div className="header-actions">
          <button onClick={callIsAvailable} className="test-btn">
            Test Contract
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Feature
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">{stats.totalFeatures}</div>
            <div className="stat-label">Total Features</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.verifiedFeatures}</div>
            <div className="stat-label">Verified Votes</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.totalVotes}</div>
            <div className="stat-label">Total Votes</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.userContributions}</div>
            <div className="stat-label">Your Actions</div>
          </div>
        </div>

        <div className="search-section">
          <input
            type="text"
            placeholder="🔍 Search features..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
          <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
            {isRefreshing ? "🔄" : "🔄"}
          </button>
        </div>

        <div className="features-grid">
          {filteredFeatures.map((feature, index) => (
            <div 
              key={feature.id}
              className="feature-card"
              onClick={() => setSelectedFeature(feature)}
            >
              <div className="feature-header">
                <h3>{feature.name}</h3>
                <div className={`status-badge ${feature.isVerified ? 'verified' : 'encrypted'}`}>
                  {feature.isVerified ? '✅ Verified' : '🔒 Encrypted'}
                </div>
              </div>
              <p className="feature-desc">{feature.description}</p>
              <div className="feature-meta">
                <span>Votes: {feature.isVerified ? feature.decryptedValue : '🔒'}</span>
                <span>{new Date(feature.timestamp * 1000).toLocaleDateString()}</span>
              </div>
              <div className="feature-creator">
                By: {feature.creator.substring(0, 6)}...{feature.creator.substring(38)}
              </div>
            </div>
          ))}
        </div>

        {filteredFeatures.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">💡</div>
            <h3>No features found</h3>
            <p>Be the first to suggest a feature!</p>
            <button 
              className="create-btn" 
              onClick={() => setShowCreateModal(true)}
            >
              Create First Feature
            </button>
          </div>
        )}

        <div className="user-history">
          <h3>Your Activity History</h3>
          <div className="history-list">
            {userHistory.slice(0, 5).map((item, index) => (
              <div key={index} className="history-item">
                <span className="history-type">{item.type === 'create' ? '📝 Created' : '🔓 Decrypted'}</span>
                <span className="history-detail">{item.feature}</span>
                <span className="history-time">{new Date(item.timestamp).toLocaleTimeString()}</span>
              </div>
            ))}
            {userHistory.length === 0 && (
              <div className="history-empty">No activity yet</div>
            )}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>Suggest New Feature</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-btn">×</button>
            </div>
            <div className="modal-body">
              <div className="fhe-notice">
                <strong>FHE 🔐 Protection</strong>
                <p>Vote count will be encrypted using Zama FHE technology</p>
              </div>
              
              <div className="form-group">
                <label>Feature Name</label>
                <input 
                  type="text"
                  value={newFeatureData.name}
                  onChange={(e) => setNewFeatureData({...newFeatureData, name: e.target.value})}
                  placeholder="Enter feature name..."
                />
              </div>
              
              <div className="form-group">
                <label>Description</label>
                <textarea 
                  value={newFeatureData.description}
                  onChange={(e) => setNewFeatureData({...newFeatureData, description: e.target.value})}
                  placeholder="Describe the feature..."
                  rows={3}
                />
              </div>
              
              <div className="form-group">
                <label>Initial Votes (Integer)</label>
                <input 
                  type="number"
                  value={newFeatureData.votes}
                  onChange={(e) => setNewFeatureData({...newFeatureData, votes: e.target.value})}
                  placeholder="Enter vote count..."
                  min="0"
                />
                <div className="data-label">FHE Encrypted Integer</div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn">Cancel</button>
              <button 
                onClick={createFeature}
                disabled={creatingFeature || isEncrypting || !newFeatureData.name}
                className="submit-btn"
              >
                {creatingFeature || isEncrypting ? "Encrypting..." : "Create Feature"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {selectedFeature && (
        <div className="modal-overlay">
          <div className="detail-modal">
            <div className="modal-header">
              <h2>Feature Details</h2>
              <button onClick={() => {
                setSelectedFeature(null);
                setDecryptedData(null);
              }} className="close-btn">×</button>
            </div>
            <div className="modal-body">
              <div className="feature-info">
                <h3>{selectedFeature.name}</h3>
                <p>{selectedFeature.description}</p>
                
                <div className="info-grid">
                  <div className="info-item">
                    <label>Current Votes</label>
                    <div className="value">
                      {selectedFeature.isVerified ? 
                        selectedFeature.decryptedValue : 
                        decryptedData !== null ? decryptedData : '🔒 Encrypted'
                      }
                    </div>
                  </div>
                  <div className="info-item">
                    <label>Status</label>
                    <div className={`value ${selectedFeature.isVerified ? 'verified' : 'encrypted'}`}>
                      {selectedFeature.isVerified ? '✅ Verified' : '🔒 Encrypted'}
                    </div>
                  </div>
                  <div className="info-item">
                    <label>Created</label>
                    <div className="value">{new Date(selectedFeature.timestamp * 1000).toLocaleDateString()}</div>
                  </div>
                  <div className="info-item">
                    <label>Creator</label>
                    <div className="value">{selectedFeature.creator.substring(0, 8)}...{selectedFeature.creator.substring(36)}</div>
                  </div>
                </div>
                
                <div className="action-section">
                  <button 
                    onClick={async () => {
                      const result = await decryptData(selectedFeature.id);
                      if (result !== null) setDecryptedData(result);
                    }}
                    disabled={isDecrypting || fheIsDecrypting}
                    className={`decrypt-btn ${selectedFeature.isVerified ? 'verified' : ''}`}
                  >
                    {isDecrypting || fheIsDecrypting ? "Decrypting..." : 
                     selectedFeature.isVerified ? "✅ Verified" : 
                     decryptedData !== null ? "🔓 Decrypted" : "🔓 Decrypt Votes"}
                  </button>
                </div>
                
                {selectedFeature.isVerified && (
                  <div className="verification-info">
                    <div className="verified-badge">✅ On-chain Verified</div>
                    <p>Vote count has been verified on the blockchain using FHE technology</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {transactionStatus.visible && (
        <div className="notification">
          <div className={`notification-content ${transactionStatus.status}`}>
            {transactionStatus.status === "pending" && <div className="spinner"></div>}
            {transactionStatus.status === "success" && <div className="icon">✓</div>}
            {transactionStatus.status === "error" && <div className="icon">✗</div>}
            <span>{transactionStatus.message}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;

