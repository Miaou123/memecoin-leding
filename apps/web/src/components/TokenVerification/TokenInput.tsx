import React, { useState, useEffect, useRef } from 'react';
import { useTokenVerification } from '../../hooks/useTokenVerification';
import TokenVerificationBadge from './TokenVerificationBadge';

interface TokenInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  required?: boolean;
  showVerification?: boolean;
  onVerificationChange?: (isValid: boolean | null) => void;
  className?: string;
  inputClassName?: string;
  error?: string;
}

function TokenInput({
  value,
  onChange,
  placeholder = 'Enter token mint address...',
  label = 'Token Address',
  disabled = false,
  required = false,
  showVerification = true,
  onVerificationChange,
  className = '',
  inputClassName = '',
  error,
}: TokenInputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  
  const { isLoading, isValid, data: verification, error: verificationError } = useTokenVerification(inputValue);

  // Sync with parent value
  useEffect(() => {
    setInputValue(value);
  }, [value]);

  // Notify parent of verification status changes
  useEffect(() => {
    if (onVerificationChange) {
      onVerificationChange(isValid);
    }
  }, [isValid, onVerificationChange]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value.trim();
    setInputValue(newValue);
    onChange(newValue);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    // Allow paste but clean up the value
    setTimeout(() => {
      const pastedValue = inputRef.current?.value?.trim() || '';
      if (pastedValue !== inputValue) {
        setInputValue(pastedValue);
        onChange(pastedValue);
      }
    }, 0);
  };

  const handleClear = () => {
    setInputValue('');
    onChange('');
    inputRef.current?.focus();
  };

  const hasError = error || verificationError;
  const showValidation = inputValue && !isLoading;
  const isValidAddress = inputValue.length >= 32 && inputValue.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(inputValue);

  return (
    <div className={`space-y-2 ${className}`}>
      {/* Label */}
      {label && (
        <label className="block text-sm font-medium text-gray-700">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}

      {/* Input Container */}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onPaste={handlePaste}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          disabled={disabled}
          placeholder={placeholder}
          className={`
            w-full px-4 py-3 border rounded-lg font-mono text-sm
            transition-all duration-200 ease-in-out
            ${hasError 
              ? 'border-red-300 focus:border-red-500 focus:ring-red-500' 
              : isValid && showValidation 
                ? 'border-green-300 focus:border-green-500 focus:ring-green-500'
                : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'
            }
            ${disabled ? 'bg-gray-50 cursor-not-allowed' : 'bg-white'}
            focus:outline-none focus:ring-2 focus:ring-opacity-50
            ${inputClassName}
          `}
          style={{ paddingRight: inputValue ? '2.5rem' : '1rem' }}
        />

        {/* Loading Spinner */}
        {isLoading && (
          <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
            <svg className="animate-spin h-4 w-4 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
        )}

        {/* Clear Button */}
        {inputValue && !isLoading && !disabled && (
          <button
            onClick={handleClear}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
            type="button"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        {/* Validation Icon */}
        {showValidation && !isLoading && (
          <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
            {isValid ? (
              <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : isValidAddress ? (
              <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
          </div>
        )}
      </div>

      {/* Format Helper */}
      {isFocused && !inputValue && (
        <p className="text-xs text-gray-500">
          Expected format: base58 encoded address (32-44 characters)
        </p>
      )}

      {/* Error Message */}
      {hasError && (
        <div className="flex items-start space-x-2 text-sm text-red-600">
          <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <span>{error || verificationError}</span>
        </div>
      )}

      {/* Token Verification Badge */}
      {showVerification && inputValue && !hasError && (
        <div className="mt-3">
          <TokenVerificationBadge
            verification={verification}
            isLoading={isLoading}
            showDetails={true}
            size="md"
          />
        </div>
      )}

      {/* Token Info */}
      {verification?.isValid && verification.name && (
        <div className="mt-2 p-3 bg-gray-50 rounded-lg">
          <div className="flex items-center space-x-3">
            {/* Token Logo Placeholder */}
            <div className="w-8 h-8 bg-gradient-to-br from-blue-400 to-blue-600 rounded-full flex items-center justify-center text-white text-xs font-bold">
              {verification.symbol?.charAt(0) || 'T'}
            </div>
            
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {verification.name}
              </p>
              <p className="text-xs text-gray-500 uppercase tracking-wide">
                {verification.symbol}
              </p>
            </div>
            
            {verification.tier && (
              <span className={`
                inline-flex items-center px-2 py-1 rounded-full text-xs font-medium
                ${verification.tier === 'gold' ? 'bg-amber-100 text-amber-800' :
                  verification.tier === 'silver' ? 'bg-blue-100 text-blue-800' :
                  'bg-yellow-100 text-yellow-800'}
              `}>
                {verification.tier.toUpperCase()}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default TokenInput;